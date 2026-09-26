FROM node:20-alpine

WORKDIR /app

# 先拷贝依赖清单并安装（纳入构建，一键启动时自动完成）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 拷贝应用源码
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
