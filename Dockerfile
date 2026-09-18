# 学习打卡网页 · 生产镜像（Day 21 交付）
# 构建：docker build -t study-checkin .
# 运行：见 docker-compose.yml（推荐），或
#   docker run -p 3000:3000 -e SESSION_SECRET=<64位随机串> -e ADMIN_PASSWORD=<强口令> -v studyin-data:/app/data study-checkin
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# 依赖层：better-sqlite3 为原生模块，alpine(musl) 上可能回退源码编译，
# 故临时安装 python3/make/g++，npm ci 完成后即从同一层删除（不进最终镜像）。
# 国内网络构建可用 --build-arg ALPINE_MIRROR=https://mirrors.tuna.tsinghua.edu.cn 切换 apk 镜像源
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org
COPY package.json package-lock.json ./
RUN if [ "$ALPINE_MIRROR" != "https://dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|https://dl-cdn.alpinelinux.org|$ALPINE_MIRROR|g" /etc/apk/repositories; \
    fi \
 && apk add --no-cache python3 make g++ \
 && npm ci --omit=dev \
 && npm cache clean --force \
 && apk del python3 make g++

# 应用代码
COPY app.js ./
COPY src ./src
COPY views ./views
COPY public ./public

# 数据目录（SQLite 库 + 上传文件）挂载为卷，容器升级数据不丢
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data

USER node
EXPOSE 3000

# 生产模式默认绑定 0.0.0.0（见 app.js HOST 逻辑）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1

CMD ["node", "app.js"]
