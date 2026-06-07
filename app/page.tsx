"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Mode = "top" | "bottom" | "both";
type Slot = "person" | "top" | "bottom";

type FilePickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};
type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
};
type FileSystemWritableFileStreamLike = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};
type FileSystemFileHandleLike = {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>;
};
declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;
  }
}

const MODE_LABEL: Record<Mode, string> = {
  top: "상의만",
  bottom: "하의만",
  both: "상하의 모두",
};

const MAX_DIM = 1280;
const QUALITY = 0.85;
const SKIP_COMPRESS_BELOW = 1.5 * 1024 * 1024;

async function compressImage(file: File): Promise<File> {
  if (file.size < SKIP_COMPRESS_BELOW && /image\/jpe?g/i.test(file.type)) return file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      img.close?.();
      return file;
    }
    ctx.drawImage(img, 0, 0, w, h);
    img.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function CameraModal({
  facingDefault,
  onCapture,
  onClose,
}: {
  facingDefault: "user" | "environment";
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">(facingDefault);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? `카메라 사용 불가: ${e.message}`
            : "카메라 사용 불가 (권한 또는 장치 확인)"
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      onCapture(file);
    }, "image/jpeg", 0.92);
  }, [onCapture]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-2xl bg-zinc-900 p-4 text-zinc-100">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">사진 촬영</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            닫기
          </button>
        </div>
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-black">
          {error ? (
            <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-red-300">
              {error}
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFacing(facing === "user" ? "environment" : "user")}
            className="flex-1 rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
          >
            카메라 전환
          </button>
          <button
            type="button"
            onClick={capture}
            disabled={!!error}
            className="flex-[2] rounded-xl bg-white px-4 py-2 font-semibold text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          >
            촬영
          </button>
        </div>
      </div>
    </div>
  );
}

function FilenamePromptDialog({
  defaultName,
  onConfirm,
  onClose,
}: {
  defaultName: string;
  onConfirm: (filename: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = name.trim() || defaultName;
    const withExt = /\.(png|jpg|jpeg|webp)$/i.test(trimmed) ? trimmed : `${trimmed}.png`;
    onConfirm(withExt);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h3 className="text-base font-semibold">파일명 입력</h3>
        <p className="text-xs text-zinc-500">
          이 브라우저는 폴더 선택을 지원하지 않아 기본 다운로드 폴더에 저장됩니다.
        </p>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="fitting"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-100"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            className="flex-1 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

function HowToModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-xl flex-col gap-3 rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">사용법 안내</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            닫기
          </button>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <li>
            <b>피팅 모드 선택</b>: 적용할 옷 종류 선택 (상의만 / 하의만 / 상하의 모두).
          </li>
          <li>
            <b>본인 사진</b>: 전신이 정면으로 나온 사진이 가장 잘 됩니다. 배경 단순,
            팔/다리 잘리지 않게. "사진 선택" 또는 "촬영" 버튼 사용.
          </li>
          <li>
            <b>옷 이미지</b>: 옷만 단독으로 찍힌 사진(쇼핑몰 상세 컷)이 가장 정확합니다.
            <ul className="mt-1 list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-400">
              <li>상의: 티셔츠, 셔츠, 자켓 등</li>
              <li>하의: 바지, 치마 등</li>
            </ul>
          </li>
          <li>
            <b>피팅 생성</b>: 버튼 클릭 후 30초~2분 대기 (상하의 모두 모드는 2배).
            첫 호출은 Cold start로 더 길 수 있습니다.
          </li>
          <li>
            <b>저장</b>: 결과가 나오면 "이미지 저장" 클릭 → <b>저장 위치(폴더)와 파일명을 선택</b>하는
            창이 열립니다.
          </li>
          <li>
            <b>오류 시</b>: 무료 Hugging Face Space 사용 중이라 일시 장애가 있을 수 있습니다.
            1~2분 후 재시도.
          </li>
        </ol>
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          폴더 선택 기능은 Chrome, Edge 등 Chromium 기반 브라우저에서만 동작합니다. 다른 브라우저는
          파일명만 입력받고 기본 다운로드 폴더에 저장됩니다. 촬영 기능은 카메라 권한 허용이
          필요하며 localhost 또는 HTTPS에서만 동작합니다.
        </p>
      </div>
    </div>
  );
}

function ImagePicker({
  slot,
  label,
  hint,
  file,
  facingDefault,
  onChange,
}: {
  slot: Slot;
  label: string;
  hint: string;
  file: File | null;
  facingDefault: "user" | "environment";
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={`pick-${slot}`} className="text-sm font-medium">
          {label}
        </label>
        {file && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            제거
          </button>
        )}
      </div>
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border-2 border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-4 text-center text-sm text-zinc-500">
            <span className="text-2xl">＋</span>
            <span>{hint}</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          사진 선택
        </button>
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          촬영
        </button>
      </div>
      <input
        ref={inputRef}
        id={`pick-${slot}`}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {showCamera && (
        <CameraModal
          facingDefault={facingDefault}
          onCapture={(f) => {
            onChange(f);
            setShowCamera(false);
          }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("top");
  const [person, setPerson] = useState<File | null>(null);
  const [top, setTop] = useState<File | null>(null);
  const [bottom, setBottom] = useState<File | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showFilenamePrompt, setShowFilenamePrompt] = useState(false);

  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  const canRun = useMemo(() => {
    if (!person) return false;
    if (mode === "top") return !!top;
    if (mode === "bottom") return !!bottom;
    return !!top && !!bottom;
  }, [person, top, bottom, mode]);

  const handleGenerate = useCallback(async () => {
    if (!person || !canRun) return;
    setLoading(true);
    setError(null);
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl(null);
      setResultBlob(null);
    }
    try {
      const personC = await compressImage(person);
      const topC = top ? await compressImage(top) : null;
      const bottomC = bottom ? await compressImage(bottom) : null;

      const form = new FormData();
      form.set("person", personC);
      form.set("mode", mode);
      if (topC && (mode === "top" || mode === "both")) form.set("top", topC);
      if (bottomC && (mode === "bottom" || mode === "both")) form.set("bottom", bottomC);

      const res = await fetch("/api/tryon", { method: "POST", body: form });
      const ctype = res.headers.get("content-type") || "";
      if (!res.ok) {
        let message = `서버 오류 ${res.status}`;
        if (ctype.includes("application/json")) {
          const data = await res.json().catch(() => null);
          if (data?.error) message = data.error;
        } else if (res.status === 413) {
          message = "업로드 용량 초과. 더 작은 이미지를 사용하세요.";
        } else if (res.status === 504 || res.status === 408) {
          message = "AI 서버 응답 지연 (timeout). 잠시 후 재시도해주세요.";
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      setResultBlob(blob);
      setResultUrl(URL.createObjectURL(blob));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "알 수 없는 오류";
      setError(msg.includes("Failed to fetch") ? "네트워크 오류 — 모바일 데이터/와이파이 확인" : msg);
    } finally {
      setLoading(false);
    }
  }, [person, top, bottom, mode, canRun, resultUrl]);

  const defaultFilename = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `fitting-${stamp}.png`;
  }, [resultUrl]);

  const saveToChosenFolder = useCallback(async () => {
    if (!resultBlob) return;
    const picker = typeof window !== "undefined" ? window.showSaveFilePicker : undefined;
    if (picker) {
      try {
        const handle = await picker({
          suggestedName: defaultFilename,
          types: [
            {
              description: "이미지 파일",
              accept: {
                "image/png": [".png"],
                "image/jpeg": [".jpg", ".jpeg"],
                "image/webp": [".webp"],
              },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(resultBlob);
        await writable.close();
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? `저장 실패: ${e.message}` : "저장 실패");
      }
    } else {
      setShowFilenamePrompt(true);
    }
  }, [resultBlob, defaultFilename]);

  const handleFallbackDownload = useCallback(
    (filename: string) => {
      if (!resultUrl) return;
      const a = document.createElement("a");
      a.href = resultUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setShowFilenamePrompt(false);
    },
    [resultUrl]
  );

  const needTop = mode === "top" || mode === "both";
  const needBottom = mode === "bottom" || mode === "both";

  const missingHint = useMemo(() => {
    const missing: string[] = [];
    if (!person) missing.push("본인 사진");
    if (needTop && !top) missing.push("상의 이미지");
    if (needBottom && !bottom) missing.push("하의 이미지");
    return missing.length ? `필요: ${missing.join(", ")}` : null;
  }, [person, top, bottom, needTop, needBottom]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:py-12">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold sm:text-3xl">가상 피팅</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            본인 사진과 옷 이미지를 올리면 AI가 체형에 맞게 피팅한 결과를 생성합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHowTo(true)}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          사용법
        </button>
      </header>

      <section className="flex flex-col gap-3">
        <span className="text-sm font-medium">피팅 모드</span>
        <div className="inline-flex w-full max-w-md gap-1 rounded-xl bg-zinc-200 p-1 dark:bg-zinc-800">
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                  : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ImagePicker
          slot="person"
          label="본인 사진"
          hint="전신이 잘 보이는 사진"
          file={person}
          facingDefault="user"
          onChange={setPerson}
        />
        <ImagePicker
          slot="top"
          label={`상의${needTop ? "" : " (사용 안 함)"}`}
          hint="상의 이미지"
          file={top}
          facingDefault="environment"
          onChange={setTop}
        />
        <ImagePicker
          slot="bottom"
          label={`하의${needBottom ? "" : " (사용 안 함)"}`}
          hint="하의 이미지"
          file={bottom}
          facingDefault="environment"
          onChange={setBottom}
        />
      </section>

      <section className="flex flex-col gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canRun || loading}
          className="w-full rounded-xl bg-zinc-900 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
        >
          {loading
            ? mode === "both"
              ? "생성 중... (2단계, 1~3분 소요)"
              : "생성 중... (30초~2분 소요)"
            : "피팅 생성"}
        </button>
        {!loading && missingHint && (
          <p className="text-center text-xs text-zinc-500">{missingHint}</p>
        )}
        {error && (
          <p className="whitespace-pre-line rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
      </section>

      {resultUrl && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">결과</h2>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl} alt="피팅 결과" className="w-full" />
          </div>
          <button
            type="button"
            onClick={saveToChosenFolder}
            className="w-full rounded-xl border border-zinc-300 bg-white px-6 py-3 text-base font-semibold transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            이미지 저장 (폴더 선택)
          </button>
        </section>
      )}

      <footer className="pt-4 text-xs text-zinc-500">
        무료 Hugging Face Space(IDM-VTON)를 호출합니다. 큐 대기 시간이 있을 수 있습니다.
      </footer>

      {showHowTo && <HowToModal onClose={() => setShowHowTo(false)} />}
      {showFilenamePrompt && (
        <FilenamePromptDialog
          defaultName={defaultFilename}
          onConfirm={handleFallbackDownload}
          onClose={() => setShowFilenamePrompt(false)}
        />
      )}
    </main>
  );
}
