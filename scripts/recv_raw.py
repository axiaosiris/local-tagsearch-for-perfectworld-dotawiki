# 接收浏览器里抓取的 _raw.json（POST /raw，text/plain 原文），落盘到 tagsearch/_raw.new.json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

OUT = r'D:/wiki/tagsearch/_raw.new.json'


class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n)
        with open(OUT, 'wb') as f:
            f.write(body)
        print('recv %d bytes -> %s' % (len(body), OUT), flush=True)
        self.send_response(200)
        self._cors()
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'OK')

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    srv = HTTPServer(('127.0.0.1', 52812), H)
    print('listening 127.0.0.1:52812', flush=True)
    srv.serve_forever()
