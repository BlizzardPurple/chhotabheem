FROM node:24-alpine
ENV NODE_ENV=production PROJECTSYNC_DEMO=true PROJECTSYNC_MODE=demo PROJECTSYNC_PUBLIC_DEMO=true HOST=0.0.0.0 PORT=3000 PROJECTSYNC_HOME=/tmp/projectsync
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/http-server.js"]
