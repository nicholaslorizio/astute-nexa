FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY bin ./bin
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY cloud-web ./cloud-web
COPY LICENSE README.md ./
ENV NODE_ENV=production PORT=4580 HOST=0.0.0.0 NEXA_DATA=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 4580
USER node
CMD ["node", "bin/nexa.js", "--no-open"]
