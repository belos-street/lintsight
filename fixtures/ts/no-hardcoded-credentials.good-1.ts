// @ts-nocheck valid-1：从环境读取（不是字面量）
export const config = {
  password: process.env.PASSWORD,
  retries: 3
}

export const apiKey = process.env.API_KEY
