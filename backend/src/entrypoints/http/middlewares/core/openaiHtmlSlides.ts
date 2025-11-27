// src/core/openaiHtmlSlides.ts
import OpenAI from 'openai';

export interface BuildSlidesResult {
  html: string;         // <-- reemplaza cualquier uso de `.output` por `.html`
}

/**
 * Genera un bloque de HTML con slides (solo contenido filatélico).
 * No mete <script> ni estilos raros; tú luego haces screenshot/PPT.
 */
export async function buildSlidesHTML(
  client: OpenAI,
  prompt: string,
  maxSlides = 12
): Promise<BuildSlidesResult> {
  const system =
    'Eres un curador filatélico. Genera HTML minimalista de diapositivas (<section> por slide), ' +
    'títulos en <h2>, párrafos breves, y NADA que no sea filatelia. No incluyas <script>. ' +
    `Máximo ${maxSlides} slides.`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.4,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ]
  });

  const html = completion.choices?.[0]?.message?.content ?? '';
  return { html };
}
