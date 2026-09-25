FROM node:22-alpine

WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.mjs"]
