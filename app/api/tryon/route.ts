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
    let message = "알 수 없는 오류";
    if (err instanceof Error) {
      message = err.message;
    } else if (err && typeof err === "object") {
      const e = err as { message?: string; title?: string };
      message = e.title && e.message ? `${e.title}: ${e.message}` : (e.message || e.title || JSON.stringify(err).slice(0, 200));
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
