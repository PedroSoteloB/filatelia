import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const PRESENTON_API_KEY = process.env.PRESENTON_API_KEY;
const PRESENTON_BASE_URL = "https://api.presenton.ai";

if (!PRESENTON_API_KEY) {
  throw new Error("Falta PRESENTON_API_KEY en el .env");
}

// 🔹 Opciones para generación a partir de texto (endpoint /generate)
export interface GeneratePresentationOptions {
  content: string;
  nSlides?: number;
  language?: string;
  template?: string;
  theme?: string;
  exportAs?: "pptx" | "pdf";
}

export interface GeneratePresentationResponse {
  presentation_id: string;
  path: string;
  edit_path: string;
  credits_consumed: number;
}

export async function generatePresentation(
  options: GeneratePresentationOptions
): Promise<GeneratePresentationResponse> {
  // 👇 por defecto: PPTX
  const payload = {
    content: options.content,
    n_slides: options.nSlides ?? 10,
    language: options.language ?? "Spanish",
    template: options.template ?? "general",
    theme: options.theme,
    export_as: options.exportAs ?? "pptx",
  };

  try {
    const res = await axios.post(
      `${PRESENTON_BASE_URL}/api/v1/ppt/presentation/generate`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${PRESENTON_API_KEY}`,
        },
      }
    );

    return res.data as GeneratePresentationResponse;
  } catch (err: any) {
    console.error("❌ Presenton /generate error");
    console.error("Status:", err.response?.status);
    console.error("Data:", err.response?.data);
    console.error("Payload que se envió:", payload);
    throw err;
  }
}

/* ===========================================================
 * Helpers para normalizar title y __image_prompt__
 *  - title: minLength 3, maxLength 30
 *  - image.__image_prompt__: minLength 10, maxLength 50
 * ===========================================================
 */

function normalizeImagePrompt(prompt: any): string | undefined {
  const trimmed = (prompt ?? "").toString().trim();

  if (!trimmed) {
    // si no hay prompt, mejor no mandar nada
    return undefined;
  }

  let result = trimmed;

  if (result.length < 10) {
    // si es muy corto, rellenamos un poco hasta llegar al mínimo
    result = (result + " imagen filatélica").slice(0, 10);
  }

  if (result.length > 50) {
    // Presenton exige maxLength = 50
    result = result.slice(0, 50);
  }

  return result;
}

function normalizeSlideTitle(title: any): string | undefined {
  const trimmed = (title ?? "").toString().trim();

  if (!trimmed) {
    return undefined;
  }

  let result = trimmed;

  // minLength 3
  if (result.length < 3) {
    result = result.padEnd(3, ".");
  }

  // maxLength 30
  if (result.length > 30) {
    result = result.slice(0, 30);
  }

  return result;
}

function sanitizePresentonPayload(payload: any): any {
  if (!Array.isArray(payload?.slides)) return payload;

  payload.slides = payload.slides.map((slide: any) => {
    const content = slide?.content || {};

    // 🔹 Normalizar título de la slide
    if (content.title !== undefined) {
      const fixedTitle = normalizeSlideTitle(content.title);
      if (fixedTitle) {
        content.title = fixedTitle;
      } else {
        delete content.title;
      }
    }

    // 🔹 Normalizar prompt de imagen, si existe
    if (content.image) {
      const image = content.image;
      const fixedPrompt = normalizeImagePrompt(image.__image_prompt__);

      if (fixedPrompt) {
        image.__image_prompt__ = fixedPrompt;
      } else {
        delete image.__image_prompt__;
      }

      content.image = image;
    }

    return {
      ...slide,
      content,
    };
  });

  return payload;
}

// 🔹 Generar presentación a partir de JSON (control total de slides/imágenes)
export async function createPresentationFromJson(body: any) {
  // 👇 por defecto: PPTX
  let payload: any = {
    ...body,
    export_as: body.export_as ?? "pptx",
  };

  // ✅ Normalizamos titles e __image_prompt__ antes de llamar a Presenton
  payload = sanitizePresentonPayload(payload);

  try {
    const res = await axios.post(
      `${PRESENTON_BASE_URL}/api/v1/ppt/presentation/create/from-json`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${PRESENTON_API_KEY}`,
        },
      }
    );
    return res.data;
  } catch (err: any) {
    console.error("❌ Presenton /create/from-json error");
    console.error("Status:", err.response?.status);
    console.error("Data:", err.response?.data);
    console.error("Body que se envió:", payload);
    throw err;
  }
}

// 🔹 Obtener definición completa de una plantilla (layouts, schema, etc.)
export async function getTemplate(templateId: string) {
  const res = await axios.get(
    `${PRESENTON_BASE_URL}/api/v1/ppt/template/${templateId}`,
    {
      headers: {
        Authorization: `Bearer ${PRESENTON_API_KEY}`,
      },
    }
  );
  return res.data;
}

// 🔹 Obtener un EJEMPLO de uso de plantilla (incluye layouts + content de muestra)
export async function getTemplateExample(templateId: string) {
  const res = await axios.get(
    `${PRESENTON_BASE_URL}/api/v1/ppt/template/${templateId}/example`,
    {
      headers: {
        Authorization: `Bearer ${PRESENTON_API_KEY}`,
      },
    }
  );
  return res.data;
}
