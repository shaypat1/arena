FROM node:20-slim

WORKDIR /app

# Copy package files
COPY services/api/package.json services/api/package.json
COPY services/wallet/package.json services/wallet/package.json

# Install API dependencies (which cover all backend deps)
RUN cd services/api && npm install --production
RUN cd services/wallet && npm install --production

# Copy all backend service source
COPY services/api/ services/api/
COPY services/wallet/ services/wallet/
COPY services/betting/ services/betting/
COPY services/realtime/ services/realtime/

EXPOSE 3001

CMD ["node", "services/api/index.js"]
