# AI 识别耗时诊断

本方案只增加耗时观测，不修改截图分辨率、JPEG 质量、AI 提示词或剧集采集规则。

## 手机日志

每次后端识别成功后会输出：

```text
[AI timing] account=账号 screen=1 encode=800ms image=1100KB http=12500ms server=3800ms ai=3500ms before_server=8700ms json_parse=20ms image_save=8ms
```

- `encode`：手机将截图编码为 JPEG/Base64 的时间。
- `image`：JPEG 原始字节大小估算值，不包含 Base64 膨胀。
- `http`：手机发送请求到收到完整响应的总时间。
- `server`：Flask 路由开始执行到识别完成的时间。
- `ai`：火山 Responses API 调用时间。
- `before_server`：`http - server`，主要包含手机上传、Nginx 接收和连接开销。
- `json_parse`：Flask 解析 JSON 请求体的时间。
- `image_save`：后端解码并保存临时截图的时间。

## Nginx 计时日志

在 `/etc/nginx/conf.d/wechat_ai_timing.conf` 中定义日志格式：

```nginx
log_format wechat_ai_timing
    '$time_iso8601 remote=$remote_addr status=$status '
    'request_time=$request_time upstream_time=$upstream_response_time '
    'request_length=$request_length body_bytes_sent=$body_bytes_sent '
    'request="$request"';
```

在 `wechat-series-monitor` 的 `server` 块中，为识别接口增加精确匹配的 location：

```nginx
location = /api/collector/series/recognize {
    client_max_body_size 10m;
    access_log /var/log/nginx/wechat-ai-timing.log wechat_ai_timing;

    proxy_pass http://127.0.0.1:5001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

修改后验证并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo tail -f /var/log/nginx/wechat-ai-timing.log
```

判断方法：

- `request_time - upstream_time` 很大：手机上传或 Nginx 接收请求体慢。
- `upstream_time - ai` 很大：Flask JSON 解析、截图保存或会话处理慢。
- `ai` 很大：火山 AI 调用变慢。
- 手机 `http` 明显大于 Nginx `request_time`：手机连接建立或响应读取慢。

## Gunicorn 会话统计

当前识别会话保存在进程内存中。为了避免两个 Gunicorn 进程分别累计调用次数，部署时使用一个进程和四个线程：

```text
gunicorn -w 1 --threads 4 -b 127.0.0.1:5001 "src.app:create_app()"
```

这不会串行阻塞 Dashboard；同一进程中的会话由现有线程锁保护。修改 systemd 后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart wechat-series-monitor
sudo systemctl status wechat-series-monitor --no-pager -l
```

## 验收

连续运行两轮，一轮设备静置后执行，一轮紧接着执行。对比：

- 总耗时、账号数和 AI 调用次数。
- 手机日志中的 `encode`、`http`、`before_server`。
- 后端返回的 `server`、`ai`、`json_parse`、`image_save`。
- Nginx 日志中的 `request_time`、`upstream_time` 和 `request_length`。

图片质量与识别结果应保持不变；成功的 AI 调用不应再因历史目录并发清理失败而返回 HTTP 500。

历史运行目录清理已从“每张截图执行一次”调整为“每个运行、每个后端进程最多执行一次”。磁盘容量和日志保留规则保持不变。
