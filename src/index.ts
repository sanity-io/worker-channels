import {type EventEmitter} from 'node:events'

function withResolvers<T = void>(Promise: PromiseConstructor) {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((thisResolve, thisReject) => {
    resolve = thisResolve
    reject = thisReject
  })

  return {promise, resolve, reject}
}

/**
 * Worker channel namespace containing types for defining structured communication
 * channels between worker threads and their parent processes.
 *
 * @example
 * ```ts
 * // Define the channel interface (shared between parent and worker)
 * // --- In a types file (e.g., types.ts) ---
 * export type MyWorkerChannel = WorkerChannel.Definition<{
 *   compileStart: WorkerChannel.Event<void>
 *   compileProgress: WorkerChannel.Stream<{ file: string; progress: number }>
 *   compileEnd: WorkerChannel.Event<{ duration: number }>
 * }>
 *
 * // --- In the worker file (e.g., worker.ts) ---
 * import {type MyWorkerChannel} from './types.ts'
 * import {parentPort} from 'node:worker_threads';
 *
 * const report = WorkerChannelReporter.from<MyWorkerChannel>(parentPort);
 *
 * async function runCompilation() {
 *   report.event.compileStart(); // Signal start
 *
 *   const files = ['a.js', 'b.js', 'c.js'];
 *   for (const file of files) {
 *     // Simulate work and report progress
 *     await new Promise(resolve => setTimeout(resolve, 100));
 *     report.stream.compileProgress.emit({ file, progress: 100 });
 *   }
 *   report.stream.compileProgress.end(); // Signal end of progress stream
 *
 *   report.event.compileEnd({ duration: 300 }); // Signal end with result
 * }
 *
 * runCompilation();
 *
 * // --- In the parent file (e.g., main.ts) ---
 * import {type MyWorkerChannel} from './types.ts'
 * import {Worker} from 'node:worker_threads';
 *
 * const worker = new Worker('./worker.js');
 * const receiver = WorkerChannelReceiver.from<MyWorkerChannel>(worker);
 *
 * async function monitorCompilation() {
 *   console.log('Waiting for compilation to start...');
 *   await receiver.event.compileStart();
 *   console.log('Compilation started.');
 *
 *   console.log('Receiving progress:');
 *   for await (const progress of receiver.stream.compileProgress()) {
 *     console.log(`  - ${progress.file}: ${progress.progress}%`);
 *   }
 *
 *   console.log('Waiting for compilation to end...');
 *   const { duration } = await receiver.event.compileEnd();
 *   console.log(`Compilation finished in ${duration}ms.`);
 *
 *   receiver.unsubscribe(); // Clean up listeners
 * }
 *
 * monitorCompilation();
 * ```
 *
 * @public
 */
export namespace WorkerChannel {
  /**
   * Allows declaring the names of events and stream types for a worker channel,
   * acting as the contract that specifying what events and streams can be
   * communicated between a worker and its parent process.
   *
   * @public
   */
  export interface Definition<
    TDefinition extends Record<string, Event<unknown> | Stream<unknown>> = Record<
      string,
      Event<unknown> | Stream<unknown>
    >,
  > {
    readonly __kind: 'definition'
    readonly __definition: TDefinition
  }

  /**
   * Represents a one-time event that can be sent from worker to parent.
   * Events are fire-and-forget messages that can only be sent once per channel.
   *
   * @public
   */
  export interface Event<TPayload = void> {
    readonly __kind: 'event'
    readonly __payload: TPayload
  }

  /**
   * Represents a stream of data that can be sent from worker to parent.
   * Streams allow multiple emissions of data followed by an end signal.
   *
   * @public
   */
  export interface Stream<TPayload = void> {
    readonly __kind: 'stream'
    readonly __payload: TPayload
  }
}

type DefinitionKeys<TDefinition extends WorkerChannel.Definition> =
  keyof TDefinition['__definition']
type PickDefinition<
  TDefinition extends WorkerChannel.Definition,
  K extends DefinitionKeys<TDefinition>,
> = TDefinition['__definition'][K]

type EventKeys<TDefinition extends WorkerChannel.Definition> = {
  [K in DefinitionKeys<TDefinition>]: PickDefinition<
    TDefinition,
    K
  > extends WorkerChannel.Event<any>
    ? K
    : never
}[DefinitionKeys<TDefinition>]
type StreamKeys<TDefinition extends WorkerChannel.Definition> = {
  [K in DefinitionKeys<TDefinition>]: PickDefinition<
    TDefinition,
    K
  > extends WorkerChannel.Stream<any>
    ? K
    : never
}[DefinitionKeys<TDefinition>]

type EventReporter<TPayload = unknown> = (payload: TPayload) => void
type EventReporters<TDefinition extends WorkerChannel.Definition> = {
  [K in EventKeys<TDefinition>]: PickDefinition<TDefinition, K> extends WorkerChannel.Event<
    infer TPayload
  >
    ? EventReporter<TPayload>
    : never
}

type StreamReporter<TPayload = unknown> = {emit: (payload: TPayload) => void; end: () => void}
type StreamReporters<TDefinition extends WorkerChannel.Definition> = {
  [K in StreamKeys<TDefinition>]: PickDefinition<TDefinition, K> extends WorkerChannel.Stream<
    infer TPayload
  >
    ? StreamReporter<TPayload>
    : never
}

type EventReceiver<TPayload = unknown> = () => Promise<TPayload>
type EventReceivers<TDefinition extends WorkerChannel.Definition> = {
  [K in EventKeys<TDefinition>]: PickDefinition<TDefinition, K> extends WorkerChannel.Event<
    infer TPayload
  >
    ? EventReceiver<TPayload>
    : never
}

type StreamReceiver<TPayload = unknown> = () => AsyncIterable<TPayload>
type StreamReceivers<TDefinition extends WorkerChannel.Definition> = {
  [K in StreamKeys<TDefinition>]: PickDefinition<TDefinition, K> extends WorkerChannel.Stream<
    infer TPayload
  >
    ? StreamReceiver<TPayload>
    : never
}

type EventMessage<TPayload = unknown> = {
  type: 'channel-event'
  name: string
  payload: TPayload
}
type StreamEmissionMessage<TPayload = unknown> = {
  type: 'channel-emission'
  name: string
  payload: TPayload
}
type StreamEndMessage = {
  type: 'channel-end'
  name: string
}

const MESSAGE_TYPES = new Set(
  Object.keys({
    'channel-emission': null,
    'channel-end': null,
    'channel-event': null,
  } satisfies Record<WorkerChannelMessage['type'], null>),
)

/**
 * Union type representing all possible message types that can be sent through worker channels.
 * These messages are used for communication between worker and parent processes.
 *
 * @public
 */
export type WorkerChannelMessage = EventMessage | StreamEmissionMessage | StreamEndMessage

/**
 * Type guard function that checks if an unknown value is a valid WorkerChannelMessage.
 * This is used to validate incoming messages from worker threads.
 *
 * @public
 */
export function isWorkerChannelMessage(message: unknown): message is WorkerChannelMessage {
  if (typeof message !== 'object') return false
  if (!message) return false
  if (!('type' in message)) return false
  if (typeof message.type !== 'string') return false
  return MESSAGE_TYPES.has(message.type)
}

interface ReceiverSubscriber {
  next: (message: unknown) => void
  error: (error: unknown) => void
}

// Originally used EventTarget but compatibility is better with something inline
class SimpleEmitter {
  #subscribers = new Map<object, () => void>()

  notify() {
    for (const subscriber of this.#subscribers.values()) {
      subscriber()
    }
  }

  subscribe(subscriber: () => void): () => void {
    const id = {}
    this.#subscribers.set(id, subscriber)

    return () => {
      this.#subscribers.delete(id)
    }
  }
}

/**
 * Internal buffer for managing stream data flow between worker and parent.
 * Handles buffering incoming messages when the worker produces data faster than
 * the parent consumes it, and provides async iteration capabilities.
 */
class StreamBuffer<T> {
  #finished = false
  #buffer: T[] = []
  #error = withResolvers<never>(Promise)
  #target = new SimpleEmitter()

  emit = (payload: T) => {
    this.#buffer.push(payload)
    this.#target.notify()
  }

  end = () => {
    this.#finished = true
    this.#target.notify()
  }

  error = (error: unknown) => {
    this.#error.reject(error)
  }

  #ready() {
    const {promise, resolve} = withResolvers<void>(Promise)

    const handler = () => {
      if (this.#buffer.length || this.#finished) {
        unsubscribe()
        resolve()
      }
    }
    const unsubscribe = this.#target.subscribe(handler)
    handler()

    return Promise.race([promise, this.#error.promise])
  }

  async *[Symbol.asyncIterator]() {
    while (!this.#finished || this.#buffer.length) {
      while (this.#buffer.length) {
        yield this.#buffer.shift()
      }
      await this.#ready()
    }
  }
}

/**
 * Receives messages from a worker thread and provides typed access to events and streams
 * defined in the worker channel definition. This class subscribes to incoming messages
 * from the worker and returns promises for events and async iterators for streams.
 *
 * @example
 * ```ts
 * // Create receiver from a Node.js Worker
 * import {Worker} from 'node:worker_threads';
 * import {type WorkerChannel, WorkerChannelReceiver} from '@sanity/worker-channels'
 *
 * type MyChannel = WorkerChannel.Definition<{
 *   myEvent: WorkerChannel.Event<string>
 *   myStream: WorkerChannel.Stream<string>
 * }>
 * const worker = new Worker('./my-worker.js');
 * const receiver = WorkerChannelReceiver.from<MyChannel>(worker);
 *
 * // Listen for events
 * const result = await receiver.event.myEvent();
 *
 * // Iterate over stream data
 * for await (const data of receiver.stream.myStream()) {
 *   console.log('Received:', data);
 * }
 *
 * // Clean up when done
 * receiver.unsubscribe();
 * ```
 *
 * @public
 */
export class WorkerChannelReceiver<TDefinition extends WorkerChannel.Definition> {
  /**
   * Creates a WorkerChannelReceiver from a worker that supports either EventEmitter
   * or EventTarget interfaces (Node.js Worker or Web Worker).
   *
   * @param worker - The worker instance to receive messages from
   * @returns A new WorkerChannelReceiver instance
   */
  static from<TDefinition extends WorkerChannel.Definition>(worker: EventTarget | EventEmitter) {
    if ('addListener' in worker) {
      return new WorkerChannelReceiver<TDefinition>((subscriber) => {
        worker.addListener('message', subscriber.next)
        worker.addListener('error', subscriber.error)

        return () => {
          worker.removeListener('message', subscriber.next)
          worker.removeListener('error', subscriber.error)
        }
      })
    }

    if ('addEventListener' in worker) {
      return new WorkerChannelReceiver<TDefinition>((subscriber) => {
        worker.addEventListener('message', subscriber.next)
        worker.addEventListener('error', subscriber.error)

        return () => {
          worker.removeEventListener('message', subscriber.next)
          worker.removeEventListener('error', subscriber.error)
        }
      })
    }

    throw new TypeError(
      'WorkerChannelReceiver.from() requires a worker that implements either the EventEmitter (Node.js Worker) or EventTarget (Web Worker) interface. ' +
        'Expected an object with addListener/removeListener methods or addEventListener/removeEventListener methods.',
    )
  }

  #events = new Map<string, PromiseWithResolvers<unknown>>()
  #streams = new Map<string, StreamBuffer<unknown>>()
  #error = withResolvers<never>(Promise)

  /** Function to call to unsubscribe from worker messages and clean up listeners */
  unsubscribe: () => void

  /**
   * Creates a new WorkerChannelReceiver instance.
   *
   * @param subscribe - Function that sets up message listeners and returns cleanup function
   */
  constructor(subscribe: (subscriber: ReceiverSubscriber) => () => void) {
    this.unsubscribe = subscribe({
      next: this.#handleMessage,
      error: this.#handleError,
    })
  }

  #handleMessage = (e: unknown): void => {
    if (!e) return
    if (typeof e !== 'object') return
    if ('data' in e && isWorkerChannelMessage(e.data)) return this.#handleMessage(e.data)
    if ('detail' in e && isWorkerChannelMessage(e.detail)) return this.#handleMessage(e.detail)
    if (!isWorkerChannelMessage(e)) return

    if (e.type === 'channel-event') this.#getEvent(e.name).resolve(e.payload)
    if (e.type === 'channel-emission') this.#getStream(e.name).emit(e.payload)
    if (e.type === 'channel-end') this.#getStream(e.name).end()
  }

  #handleError = (e: unknown): void => {
    if (typeof CustomEvent !== 'undefined' && e instanceof CustomEvent) {
      this.#error.reject(e.detail)
    } else {
      this.#error.reject(e)
    }
  }

  #getEvent(name: string) {
    const event = this.#events.get(name) ?? withResolvers(Promise)
    if (!this.#events.has(name)) this.#events.set(name, event)
    return event
  }

  #getStream(name: string) {
    const stream = this.#streams.get(name) ?? new StreamBuffer()
    if (!this.#streams.has(name)) this.#streams.set(name, stream)
    this.#error.promise.catch(stream.error)
    return stream
  }

  /**
   * Provides typed access to event receivers. Each property corresponds to an event
   * defined in the channel definition and returns a function that resolves when
   * the event is received from the worker.
   */
  event = new Proxy({} as EventReceivers<TDefinition>, {
    get: (...[, name]): EventReceiver | undefined => {
      if (typeof name !== 'string') return undefined
      return () => Promise.race([this.#getEvent(name).promise, this.#error.promise])
    },
  })

  /**
   * Provides typed access to stream receivers. Each property corresponds to a stream
   * defined in the channel definition and returns a function that returns an async
   * iterator for receiving streamed data from the worker.
   */
  stream = new Proxy({} as StreamReceivers<TDefinition>, {
    get: (...[, name]): StreamReceiver | undefined => {
      if (typeof name !== 'string') return undefined
      return () => this.#getStream(name)
    },
  })
}

/**
 * Interface for objects that can send messages to a parent process.
 * This provides a common abstraction for different types of parent ports
 * used in various worker environments.
 *
 * @public
 */
export interface ParentPortLike {
  /** Sends a message to the parent process */
  postMessage: (message: unknown) => void
}

/**
 * Reports events and streams from a worker thread to its parent process.
 * This class provides typed methods for sending events and streaming data
 * according to the worker channel definition.
 *
 * @param TDefinition - The worker channel definition interface
 *
 * @example
 * ```ts
 * // Inside a worker thread
 * import {parentPort} from 'node:worker_threads';
 * import {type WorkerChannel, WorkerChannelReporter} from '@sanity/worker-channels'
 *
 * type MyChannel = WorkerChannel.Definition<{
 *   taskCompleted: WorkerChannel.Event<{result: 'success' | 'failure'}>
 *   progress: WorkerChannel.Stream<{percent: number}>
 * }>
 *
 * const report = WorkerChannelReporter.from<MyChannel>(parentPort);
 *
 * // Report a one-time event
 * report.event.taskCompleted({ result: 'success' });
 *
 * // Stream progress updates
 * for (let i = 0; i <= 100; i += 10) {
 *   report.stream.progress.emit({ percent: i });
 *   await new Promise(resolve => setTimeout(resolve, 100));
 * }
 * report.stream.progress.end();
 * ```
 *
 * @public
 */
export class WorkerChannelReporter<TDefinition extends WorkerChannel.Definition> {
  /**
   * Creates a WorkerChannelReporter from a parent port or event target.
   * Supports Node.js parentPort, EventTarget, EventEmitter, or custom ParentPortLike objects.
   *
   * @param parentPort - The parent port or event target to send messages to
   * @returns A new WorkerChannelReporter instance
   * @throws Error if parentPort is null or doesn't implement required interface
   */
  static from<TDefinition extends WorkerChannel.Definition>(
    parentPort: ParentPortLike | EventTarget | EventEmitter | null,
  ) {
    if (!parentPort) {
      throw new Error(
        `WorkerChannelReporter.from() requires a valid parent port. ` +
          `Expected a non-null object, but received: ${String(parentPort)}.`,
      )
    }
    if ('postMessage' in parentPort) {
      return new WorkerChannelReporter<TDefinition>((message) => parentPort.postMessage(message))
    }
    if (
      'dispatchEvent' in parentPort &&
      'addEventListener' in parentPort &&
      typeof CustomEvent !== 'undefined'
    ) {
      return new WorkerChannelReporter<TDefinition>((message) =>
        parentPort.dispatchEvent(new CustomEvent('message', {detail: message})),
      )
    }
    if ('emit' in parentPort && 'addListener' in parentPort) {
      return new WorkerChannelReporter<TDefinition>((message) =>
        parentPort.emit('message', message),
      )
    }

    throw new TypeError(
      `WorkerChannelReporter.from() requires a parent port that implements one ` +
        `of the supported interfaces: ParentPortLike (with a postMessage method), ` +
        `EventTarget (with dispatchEvent), or EventEmitter (with emit method). ` +
        `The provided object does not implement any of these interfaces.`,
    )
  }

  #postMessage: (message: WorkerChannelMessage) => void
  #reportedEvents = new Set<string>()
  #finishedStreams = new Set<string>()

  /**
   * Creates a new WorkerChannelReporter instance.
   *
   * @param postMessage - Function to send messages to the parent process
   */
  constructor(postMessage: (message: WorkerChannelMessage) => void) {
    this.#postMessage = postMessage
  }

  /**
   * Provides typed access to event reporters. Each property corresponds to an event
   * defined in the channel definition and returns a function that sends the event
   * to the parent process. Each event can only be reported once.
   */
  event = new Proxy({} as EventReporters<TDefinition>, {
    get: (...[, name]): EventReporter | undefined => {
      if (typeof name !== 'string') return undefined
      return (payload) => {
        if (this.#reportedEvents.has(name)) {
          throw new Error(
            `Cannot report event "${name}" because it has already been reported. ` +
              `Each event in a worker channel can only be reported and received once.`,
          )
        }
        this.#reportedEvents.add(name)
        this.#postMessage({type: 'channel-event', name, payload})
      }
    },
  })

  /**
   * Provides typed access to stream reporters. Each property corresponds to a stream
   * defined in the channel definition and returns an object with `emit()` and `end()`
   * methods for sending streaming data to the parent process.
   */
  stream = new Proxy({} as StreamReporters<TDefinition>, {
    get: (...[, name]): StreamReporter | undefined => {
      if (typeof name !== 'string') return undefined
      return {
        emit: (payload) => {
          if (this.#finishedStreams.has(name)) {
            throw new Error(
              `Cannot emit to stream "${name}" because it has already been finished. ` +
                `Once a stream is ended with .end(), no more data can be emitted to it.`,
            )
          }
          this.#postMessage({type: 'channel-emission', name, payload})
        },
        end: () => {
          if (this.#finishedStreams.has(name)) {
            throw new Error(
              `Cannot end stream "${name}" because it has already been finished. ` +
                'Each stream can only be ended once.',
            )
          }
          this.#finishedStreams.add(name)
          this.#postMessage({type: 'channel-end', name})
        },
      }
    },
  })
}
