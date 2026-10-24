#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
nginx_site=/etc/nginx/sites-available/default
nginx_backup=/etc/nginx/sites-available/default.web_slides.bak

if [ "$(id -u)" -eq 0 ]; then
    echo "请以普通用户运行此脚本；脚本会在需要时自行调用 sudo。" >&2
    exit 1
fi

cd "$project_root"
npm run build
test -f "$project_root/dist/index.html"

if ! command -v setfacl >/dev/null 2>&1; then
    echo "缺少 setfacl；请先运行：sudo apt install acl" >&2
    exit 1
fi

sudo -v
# Grant only the Nginx worker access: traverse the private home/project path,
# then read the public build output. Reapply after every Vite build because
# emptyOutDir recreates dist contents.
case "$project_root/" in
    "$HOME"/*) sudo setfacl -m u:www-data:--x "$HOME" ;;
esac
sudo setfacl -m u:www-data:--x "$project_root"
sudo setfacl -R -m u:www-data:r-- "$project_root/dist"
sudo find "$project_root/dist" -type d -exec setfacl -m u:www-data:r-x {} +

if [ ! -e "$nginx_backup" ]; then
    sudo cp -a "$nginx_site" "$nginx_backup"
fi
sudo install -m 0644 "$script_dir/nginx.conf" "$nginx_site"
if ! sudo nginx -t; then
    sudo cp -a "$nginx_backup" "$nginx_site"
    echo "Nginx 配置校验失败，已恢复原配置。" >&2
    exit 1
fi

sudo systemctl reload nginx
echo "前端已构建至 $project_root/dist，Nginx 已切换为直接提供静态文件。"
