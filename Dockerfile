# المرحلة الأولى: البناء
FROM node:18 AS builder

# تحديد مجلد العمل
WORKDIR /app

# نسخ ملفات الباكج أولاً علشان الكاش
COPY package*.json ./

# تثبيت الديبندنسيز
RUN npm install

# نسخ باقي المشروع
COPY . .

# بناء المشروع
RUN npm run build

# المرحلة الثانية: التشغيل
FROM node:18-alpine AS runner

WORKDIR /app

# نسخ الملفات المطلوبة فقط من مرحلة البناء
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

# تحديد البورت
EXPOSE 3000

# أمر التشغيل
CMD ["npm", "start"]
