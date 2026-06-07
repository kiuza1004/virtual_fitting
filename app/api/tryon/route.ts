import { Client, handle_file } from "@gradio/client";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const SPACE = process.env.HF_SPACE || "yisol/IDM-VTON";
const HF_TOKEN = process.env.HF_TOKEN as `hf_${string}` | undefined;

type ClothType = "upper" | "lower";
type FileDataLike = { url?: string; path?: string };

const BLANK_MASK_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=";

const PROMPT_BY_TYPE: Record<ClothType, string> = {
  upper: "a top garment, shirt",
  lower: "pants, bottom garment",
};

function blankMaskBlob(): Blob {
  return new Blob([new Uint8Array(Buffer.from(BLANK_MASK_PNG_B64, "base64"))], {
    type: "image/png",
  });
}

async function blobFromResult(data: unknown): Promise<Blob> {
  const item = Array.isArray(data) ? (data[0] as FileDataLike) : (data as FileDataLike);
  const url = item?.url;
  if (!url) throw new Error("Space가 이미지 URL을 반환하지 않았습니다.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`결과 이미지 다운로드 실패: ${res.status}`);
  return await res.blob();
}

async function tryonOnce(person: Blob, garment: Blob, clothType: ClothType): Promise<Blob> {
  const client = await Client.connect(SPACE, HF_TOKEN ? { token: HF_TOKEN } : {});
  const result = await client.predict("/tryon", [
    {
      background: handle_file(person),
      layers: [handle_file(blankMaskBlob())],
      composite: null,
    },
    handle_file(garment),
    PROMPT_BY_TYPE[clothType],
    true,
    false,
    30,
    42,
  ]);
  return blobFromResult(result.data);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const person = formData.get("person");
    const top = formData.get("top");
    const bottom = formData.get("bottom");
    const mode = (formData.get("mode") as string | null) ?? "top";

    if (!(person instanceof Blob)) {
      return Response.json({ error: "본인 사진이 필요합니다." }, { status: 400 });
    }

    const needTop = mode === "top" || mode === "both";
    const needBottom = mode === "bottom" || mode === "both";

    if (needTop && !(top instanceof Blob)) {
      return Response.json({ error: "상의 이미지가 필요합니다." }, { status: 400 });
    }
    if (needBottom && !(bottom instanceof Blob)) {
      return Response.json({ error: "하의 이미지가 필요합니다." }, { status: 400 });
    }

    let current: Blob = person;
    if (needBottom) current = await tryonOnce(current, bottom as Blob, "lower");
    if (needTop) current = await tryonOnce(current, top as Blob, "upper");

    const buffer = Buffer.from(await current.arrayBuffer());
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": current.type || "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/tryon] error:", err);
    let raw = "알 수 없는 오류";
    if (err instanceof Error) {
      raw = err.message;
    } else if (err && typeof err === "object") {
      const e = err as { message?: string; title?: string };
      raw = e.title && e.message ? `${e.title}: ${e.message}` : (e.message || e.title || JSON.stringify(err).slice(0, 200));
    }
    return Response.json({ error: translateError(raw) }, { status: 500 });
  }
}

function translateError(raw: string): string {
  // ZeroGPU 할당량 초과
  const quota = raw.match(/exceeded your free ZeroGPU quota.*?\((\d+)s requested vs\. (\d+)s left\).*?Try again in ([\d:]+)/i);
  if (quota) {
    const [, requested, left, remain] = quota;
    const human = formatRemain(remain);
    return `무료 ZeroGPU 일일 할당량이 소진되었습니다.\n` +
      `· 이번 요청에 필요한 시간: ${requested}초\n` +
      `· 남은 할당량: ${left}초\n` +
      `· 다시 사용 가능: 약 ${human} 후 (${remain})\n\n` +
      `해결 방법:\n` +
      `1) ${human} 후 재시도\n` +
      `2) 다른 무료 HF 계정으로 새 토큰을 발급해 환경변수 HF_TOKEN 교체`;
  }
  // 게이트웨이 타임아웃
  if (/504|gateway timeout|timeout/i.test(raw)) {
    return `요청이 시간 초과되었습니다 (서버 응답이 너무 느림).\n잠시 후 다시 시도하거나, 이미지를 더 작게 압축해 보세요.`;
  }
  // 요청 본문 크기 초과
  if (/413|payload too large|request entity too large/i.test(raw)) {
    return `이미지 용량이 너무 큽니다 (서버 제한 초과).\n더 작은 사진을 사용하거나 다시 촬영해 주세요.`;
  }
  // ZeroGPU 워커 오류
  if (/AcceleratorError|GPU.*?(error|fail)/i.test(raw)) {
    return `GPU 워커가 일시적으로 작동하지 않습니다 (서버 측 문제).\n수 분 후 다시 시도해 주세요.`;
  }
  // 인증 오류
  if (/401|unauthorized|invalid token/i.test(raw)) {
    return `Hugging Face 토큰이 유효하지 않습니다.\n환경변수 HF_TOKEN을 확인해 주세요.`;
  }
  // Space 미존재/엔드포인트 없음
  if (/no endpoint|api_name|not found/i.test(raw)) {
    return `해당 Space의 API 엔드포인트를 찾을 수 없습니다.\nHF_SPACE 설정 또는 Space 상태를 확인해 주세요.`;
  }
  return raw;
}

function formatRemain(hhmmss: string): string {
  const parts = hhmmss.split(":").map(Number);
  let h = 0, m = 0;
  if (parts.length === 3) { [h, m] = parts; }
  else if (parts.length === 2) { [m] = parts; }
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  if (m > 0) return `${m}분`;
  return "잠시";
}
