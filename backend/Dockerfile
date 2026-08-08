FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package configurations
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application files
COPY . .

# Expose port 7860 (required by Hugging Face Spaces)
ENV PORT=7860
EXPOSE 7860

# Start the application
CMD ["npm", "start"]
