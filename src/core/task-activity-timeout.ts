export interface TaskActivityTimeoutController {
  signal: AbortSignal;
  touch: () => void;
  wrap: <T>(operation: Promise<T>) => Promise<T>;
  cleanup: () => void;
}

export function createTaskActivityTimeoutController(
  externalSignal?: AbortSignal,
  timeoutMs?: number,
): TaskActivityTimeoutController {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      const abortFromExternal = (): void => {
        controller.abort(externalSignal.reason);
      };

      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
      cleanups.push(() => externalSignal.removeEventListener("abort", abortFromExternal));
    }
  }

  const armTimeout = (): void => {
    if (!timeoutMs || timeoutMs <= 0 || controller.signal.aborted) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      controller.abort(new Error(`TASK_TIMEOUT:${timeoutMs}`));
    }, timeoutMs);
  };

  const wrap = async <T>(operation: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error("Task activity timeout aborted.");
    }

    return await new Promise<T>((resolve, reject) => {
      const abort = (): void => {
        controller.signal.removeEventListener("abort", abort);
        reject(
          controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new Error("Task activity timeout aborted."),
        );
      };

      controller.signal.addEventListener("abort", abort, { once: true });
      void operation.then(
        (value) => {
          controller.signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          controller.signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  };

  armTimeout();
  cleanups.push(() => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });

  return {
    signal: controller.signal,
    touch: () => {
      armTimeout();
    },
    wrap,
    cleanup: () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    },
  };
}
