FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY entrypoint.sh ./scripts/entrypoint.sh
RUN chmod +x ./scripts/entrypoint.sh
ENV NODE_ENV=production
ENV PORT=3400
EXPOSE 3400
ENTRYPOINT ["./scripts/entrypoint.sh"]
CMD ["node", "dist/server/main.js"]
