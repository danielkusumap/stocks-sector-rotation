import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  apiPost,
  apiUpload,
  type IngestRun,
  type StartRunResponse,
} from "../lib/api";
import { RUN_KIND, isFinal, type PipelineStep } from "../lib/pipeline";
import { useRun } from "./useApiQuery";

/**
 * Menjalankan satu langkah pipeline. Selalu `?async=true` supaya UI tidak nge-block
 * (docs/05 §4.1: ingest 962 emiten ±95 detik).
 */
export function startStep(step: PipelineStep, file?: File): Promise<StartRunResponse> {
  const params = { async: true };
  if (file) return apiUpload<StartRunResponse>("/admin/import/excel", file, params);
  if (step.kind === RUN_KIND.midday) {
    return apiPost<StartRunResponse, Record<string, never>>("/admin/midday", {}, params);
  }
  const path = step.kind.startsWith("prices") ? "/admin/ingest/prices" : "/admin/compute";
  return apiPost<StartRunResponse, object>(path, step.body ?? {}, params);
}

export function useStartStep(
  onStarted: (run: StartRunResponse) => void,
  onError: (error: unknown) => void,
) {
  return useMutation({
    mutationFn: ({ step, file }: { step: PipelineStep; file?: File }) => startStep(step, file),
    onSuccess: (run) => onStarted(run),
    onError,
  });
}

/**
 * Progres satu run. `onFinal` dipanggil sekali saat status final — di situlah
 * cache data tampilan di-invalidate (docs/05 §5.1: "Refresh data tampilan").
 */
export function useRunProgress(runId: number | null, onFinal: (run: IngestRun) => void) {
  const query = useRun(runId);
  const run = query.data?.run;
  const status = run?.status;
  const id = run?.run_id;

  useEffect(() => {
    if (!run || !isFinal(status)) return;
    onFinal(run);
    // sengaja: hanya saat run masuk status final, bukan setiap render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status]);

  return query;
}

export function useRefreshAll() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries();
}
