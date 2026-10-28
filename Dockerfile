FROM oven/bun:1.4.4 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY server ./server
COPY src/domain ./src/domain
COPY src/backup/archive.ts ./src/backup/archive.ts
COPY src/processing/jobs.ts ./src/processing/jobs.ts
COPY src/processing/review.ts src/processing/request.ts ./src/processing/
COPY src/leads/types.ts ./src/leads/types.ts
USER bun
EXPOSE 8080
CMD ["bun", "server/hosted.ts"]
