#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

cd "$project_root"
npm run build:server

echo "启动 release 后端：http://127.0.0.1:3001"
exec "$project_root/target/release/jinglun-server"
