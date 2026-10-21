/**
 * `@physiomelinks/bg2cellml/worker`: converting in a Web Worker, so libCellML's
 * checks never hold up the page. The worker script calls
 * `startConversionWorker()`; the page talks to it with `createConversionWorker()`.
 */

export {
  createConversionHandler,
  startConversionWorker,
  type ConversionHandler,
  type WorkerScope,
  type WorkerSetup,
} from './handler.js'
export {
  createConversionWorker,
  type ConversionWorker,
  type ConversionWorkerOptions,
  type LatestConversion,
  type WorkerConversion,
  type WorkerLike,
} from './client.js'
export type {
  ConvertRequest,
  DefaultsRequest,
  ErrorResponse,
  InitRequest,
  ReadyResponse,
  ResultResponse,
  SupersededResponse,
  WasmUrls,
  WorkerFramework,
  WorkerRequest,
  WorkerResponse,
} from './protocol.js'
