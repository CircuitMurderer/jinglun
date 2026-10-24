use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use jinglun_world::{GenerationError, MapConfig, WorldMap};
use serde::Serialize;
use std::{sync::Arc, time::Instant};
use tokio::sync::Semaphore;

#[derive(Serialize)]
struct MapResponse {
    map: WorldMap,
    meta: Meta,
}
#[derive(Serialize)]
struct Meta {
    generation_ms: f64,
}

fn error(status: StatusCode, code: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": { "code": code, "params": {} } })),
    )
        .into_response()
}

async fn generate_map(
    State(slots): State<Arc<Semaphore>>,
    payload: Result<Json<MapConfig>, JsonRejection>,
) -> Response {
    let config = match payload {
        Ok(Json(config)) => config,
        Err(_) => return error(StatusCode::BAD_REQUEST, "error.invalid_request"),
    };
    if let Err(failure) = config.validate() {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "error": failure })),
        )
            .into_response();
    }
    let permit = match slots.try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return error(StatusCode::TOO_MANY_REQUESTS, "error.busy"),
    };
    // CPU-bound generation never blocks the async HTTP executor. The permit
    // lives inside the task even if the requesting client disconnects.
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let start = Instant::now();
        jinglun_world::generate(config).map(|map| MapResponse {
            map,
            meta: Meta {
                generation_ms: start.elapsed().as_secs_f64() * 1000.0,
            },
        })
    })
    .await;
    match result {
        Ok(Ok(response)) => Json(response).into_response(),
        Ok(Err(failure @ GenerationError { .. })) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "error": failure })),
        )
            .into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "error.generation"),
    }
}

fn app() -> Router {
    Router::new()
        .route(
            "/api/health",
            get(async || {
                Json(serde_json::json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
            }),
        )
        .route("/api/maps/generate", post(generate_map))
        .layer(DefaultBodyLimit::max(4096))
        .with_state(Arc::new(Semaphore::new(2)))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address = std::env::var("JINGLUN_BIND").unwrap_or_else(|_| "127.0.0.1:3001".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    println!("经纶后端：http://{}", listener.local_addr()?);
    axum::serve(listener, app())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    async fn request(body: &str) -> (StatusCode, serde_json::Value) {
        let response = app()
            .oneshot(
                Request::post("/api/maps/generate")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_owned()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 20_000_000).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn api_returns_real_world_and_structured_errors() {
        let (status, body) = request(r#"{"seed":"接口验证","cell_count":100}"#).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["map"]["generator_version"], "0.9.0-geo");
        assert_eq!(
            body["map"]["environment"]["water_budget"]["months"]
                .as_array()
                .unwrap()
                .len(),
            12
        );
        assert!(body["map"]["environment"]["basins"].is_array());
        assert!(body["map"]["environment"]["water_sources"].is_array());
        assert_eq!(
            body["map"]["cells"][0]["groundwater"]["months"]
                .as_array()
                .unwrap()
                .len(),
            12
        );
        assert!(body["map"]["cells"][0]["water_source_ids"].is_array());
        assert_eq!(body["map"]["cells"].as_array().unwrap().len(), 100);
        assert_eq!(
            body["map"]["cells"][0]["climate"]["months"]
                .as_array()
                .unwrap()
                .len(),
            12
        );
        assert!(body["meta"]["generation_ms"].as_f64().unwrap() > 0.0);
        let (status, body) = request(r#"{"cell_count":999999}"#).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"]["code"], "error.cell_count");
        let (status, body) = request("not-json").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"]["code"], "error.invalid_request");
        let (status, _) = request(r#"{"cellCount":500}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
}
