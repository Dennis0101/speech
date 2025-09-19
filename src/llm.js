// src/llm.js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAXTOK = Number(process.env.SUMMARY_MAXTOKENS || 180);

/**
 * 긴 본문에서 2~3문장 요약 생성
 * @param {string} body  - 기사 본문 텍스트
 * @param {'ko'|'en'} lang
 * @returns {Promise<string>}
 */
export async function summarize(body, lang = 'ko') {
  if (!body || body.trim().length < 40) return ''; // 본문이 너무 짧으면 패스
  const instruction =
    lang === 'ko'
      ? '다음 뉴스 내용을 2~3문장으로 간결하게 요약해줘. 과장 금지, 핵심 수치/사실만.'
      : 'Summarize the following article in 2-3 concise sentences. No hype; include key facts or numbers.';

  try {
    // Chat Completions (공식 SDK)
    const resp = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: MAXTOK,
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: body.slice(0, 6000) } // 너무 길면 자름
      ]
    });
    return (resp.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.error('summarize error:', e.message);
    return '';
  }
}
