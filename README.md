# @sanity/worker-channels

[![npm version](https://img.shields.io/npm/v/@sanity/worker-channels.svg)](https://www.npmjs.com/package/@sanity/worker-channels) [![bundle size](https://deno.bundlejs.com/?q=@sanity/worker-channels&badge)](https://bundlejs.com/?q=@sanity/worker-channels) [![github status checks](https://badgen.net/github/checks/sanity-io/worker-channels)](https://github.com/sanity-io/worker-channels/actions) [![npm weekly downloads](https://img.shields.io/npm/dw/@sanity/worker-channels.svg)](https://www.npmjs.com/package/@sanity/worker-channels) [![semantic-release: angular](https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)

> Type-safe, structured communication between worker threads and parent processes via TypeScript meta-programming.

## Table of Contents

- [Motivation](#motivation)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [1. Define your channel contract](#1-define-your-channel-contract)
  - [2. Report events in your worker thread](#2-report-events-in-your-worker-thread)
  - [3. Await events in your parent process](#3-await-events-in-your-parent-process)
- [Usage Examples](#usage-examples)
  - [Node.js Workers](#nodejs-workers)
  - [Web Workers](#web-workers)
  - [EventEmitter](#eventemitter)
  - [EventTarget](#eventtarget)
- [API Reference](#api-reference)
  - [`WorkerChannel.Definition`](#workerchanneldefinition-workerchannelevent-workerchannelstream)
  - [`WorkerChannelReporter`](#workerchannelreporter)
  - [`WorkerChannelReceiver`](#workerchannelreceiver)
- [Important Caveats](#important-caveats)
  - [Events are one-time only](#events-are-one-time-only)
  - [Streams must be ended](#streams-must-be-ended)
  - [Control flow must match between worker and parent](#control-flow-must-match-between-worker-and-parent)
- [LICENSE](#license)

## Motivation

Worker communication often becomes messy when different types of messages flow through the same channel. Worker channels provide **type-safe, structured communication** with clear contracts defined entirely in TypeScript.

<table>
<thead>
<tr>
<th>Traditional Approach ❌</th>
<th>Worker Channels ✅</th>
</tr>
</thead>

<tbody>
<tr>
<td>

```ts
// ================= worker.ts ====================
// traditional worker — simple enough
// ================================================

import {parentPort, workerData} from 'node:worker_threads'
import {processImage} from './processImage'

const imageFiles = workerData

parentPort.postMessage({
  type: 'started',
  expected: imageFiles.length,
})

let processed = 0
for (let i = 0; i < imageFiles.length; i++) {
  const file = imageFiles[i]

  try {
    const result = await processImage(file)
    parentPort.postMessage({
      type: 'progress',
      file: file.name,
      completed: i + 1,
      result,
    })
    processed++
  } catch {
    // ...
  }
}

parentPort.postMessage({
  type: 'finished',
  processed,
})
```

</td>

<td>

```ts
// ================ worker.ts ========================
// worker-channel worker — still simple and type-safe!
// ===================================================
import {parentPort, workerData} from 'node:worker_threads'
import {WorkerChannelReporter} from '@sanity/worker-channels'
import {processImage} from './processImage'
import type {ImageChannel} from '...'

const report = WorkerChannelReporter.from<ImageChannel>(parentPort)
const imageFiles = workerData

report.event.started({expected: imageFiles.length})

let processed = 0
for (let i = 0; i < imageFiles.length; i++) {
  const file = imageFiles[i]

  try {
    const result = await processImage(file)
    report.stream.progress.emit({
      file: file.name,
      completed: i + 1,
      result,
    })
    processed++
  } catch {
    // ...
  }
}
report.stream.progress.end()

report.event.finished({processed})
```

</td>
</tr>

<tr>
<td>

```ts
// ================= main.ts ===================
// a traditional parent — spaghetti control flow
// =============================================
import {Worker} from 'node:worker_threads'

const worker = new Worker(/* ... */)
let expected = 0

await new Promise((resolve, reject) => {
  worker.on('message', (msg) => {
    switch (msg.type) {
      case 'started':
        expected = msg.expected
        console.log(`Processing ${expected} images...`)
        break
      case 'progress':
        const {file, completed} = msg
        console.log(`${file}: ${completed}/${expected}`)
        break
      case 'finished':
        const {processed} = msg
        console.log(`Processed ${processed}/${expected}`)
        resolve()
        break
      default:
        console.warn('Unknown message type:', msg.type)
    }
  })

  // don't forget to propagate errors
  worker.on('error', reject)
})
```

</td>
<td>

```ts
// ==================== main.ts =======================
// a worker-channel parent — control flow matches child
// ====================================================
import {Worker} from 'node:worker_threads'
import {WorkerChannelReceiver} from '@sanity/worker-channels'
import type {ImageChannel} from '...'

const worker = new Worker(/* ... */)

const receiver = WorkerChannelReceiver.from<ImageChannel>(worker)

// BONUS: the receiver automatically propagates errors
const {expected} = await receiver.event.started()
console.log(`Processing ${expected} images...`)

for await (const progress of receiver.stream.progress()) {
  const {file, completed} = progress
  console.log(`${file}: ${completed}/${expected}`)
}

const {processed} = await receiver.event.finished()
console.log(`Processed ${processed}/${expected}`)

receiver.unsubscribe() // clean up after the worker
```

</td>
</tr>
</tbody>
</table>

> [!IMPORTANT]
> The channel contract exists **solely in TypeScript types** and is shared between worker and parent processes.

This library uses Proxies to dynamically intercept property access and route messages to the correct handlers, providing **compile-time safety with minimal runtime overhead** while keeping worker and parent code cleanly isolated.

```ts
import {type WorkerChannel} from '@sanity/worker-channels'

// both the child and parent can import this with a type import
export type ImageChannel = WorkerChannel.Definition<{
  started: WorkerChannel.Event<{expected: number}>
  progress: WorkerChannel.Stream<{file: ImageFile; completed: number}>
  finished: WorkerChannel.Event<{processed: number}>
}>
```

## Installation

```bash
npm install @sanity/worker-channels
```

## Quick Start

### 1. Define your channel contract

```ts
// types.ts - shared between worker and parent
import {type WorkerChannel} from '@sanity/worker-channels'

export type BuildChannel = WorkerChannel.Definition<{
  buildStart: WorkerChannel.Event<{target: string}>
  progress: WorkerChannel.Stream<{file: string; percent: number}>
  buildComplete: WorkerChannel.Event<{duration: number; files: string[]}>
}>
```

### 2. Report events in your worker thread

```ts
// worker.ts
import {parentPort} from 'node:worker_threads'
import {WorkerChannelReporter} from '@sanity/worker-channels'
import type {BuildChannel} from './types'

const report = WorkerChannelReporter.from<BuildChannel>(parentPort)

// Signal build started
report.event.buildStart({target: 'production'})

// Stream progress updates
const files = ['app.js', 'styles.css', 'index.html']
for (let i = 0; i < files.length; i++) {
  report.stream.progress.emit({
    file: files[i],
    percent: Math.round(((i + 1) / files.length) * 100),
  })
  await new Promise((resolve) => setTimeout(resolve, 1000)) // Simulate work
}
report.stream.progress.end() // Important: end the stream

// Signal completion
report.event.buildComplete({duration: 3000, files})
```

### 3. Await events in your parent process

```ts
// main.ts
import {Worker} from 'node:worker_threads'
import {WorkerChannelReceiver} from '@sanity/worker-channels'
import type {BuildChannel} from './types'

const worker = new Worker('./worker.js')
const receiver = WorkerChannelReceiver.from<BuildChannel>(worker)

// Wait for build to start
const {target} = await receiver.event.buildStart()
console.log(`Build started for ${target}`)

// Monitor progress stream
for await (const {file, percent} of receiver.stream.progress()) {
  console.log(`${file}: ${percent}%`)
}

// Wait for completion
const {duration, files} = await receiver.event.buildComplete()
console.log(`Build completed in ${duration}ms, ${files.length} files`)

receiver.unsubscribe() // Clean up
```

## Usage Examples

### Node.js Workers

```ts
import {Worker} from 'node:worker_threads'
import {parentPort} from 'node:worker_threads'

// Worker thread
const report = WorkerChannelReporter.from<MyChannel>(parentPort)

// Parent process
const worker = new Worker('./worker.js')
const receiver = WorkerChannelReceiver.from<MyChannel>(worker)
```

### Web Workers

```ts
// In web worker
const report = WorkerChannelReporter.from<MyChannel>(self)

// In main thread
const worker = new Worker('./worker.js')
const receiver = WorkerChannelReceiver.from<MyChannel>(worker)
```

### EventEmitter

Useful for asynchronously reporting progress within the same thread in Node.js.

```ts
import {EventEmitter} from 'node:events'

const emitter = new EventEmitter()
const reporter = WorkerChannelReporter.from<MyChannel>(emitter)
const receiver = WorkerChannelReceiver.from<MyChannel>(emitter)
```

### EventTarget

Similarly, `EventTarget` is also supported and useful for asynchronously reporting progress within the same thread in non-Node.js environments.

```ts
const target = new EventTarget()
const reporter = WorkerChannelReporter.from<MyChannel>(target)
const receiver = WorkerChannelReceiver.from<MyChannel>(target)
```

## API Reference

### `WorkerChannel.Definition`, `WorkerChannel.Event`, `WorkerChannel.Stream`

```ts
type MyChannel = WorkerChannel.Definition<{
  eventName: WorkerChannel.Event<PayloadType> // One-time events
  streamName: WorkerChannel.Stream<PayloadType> // Continuous data streams
}>
```

### `WorkerChannelReporter`

Reports events and streams from worker to parent process.

#### Creation

**Static factory (recommended):**

```ts
// Automatically detects the interface type
const report = WorkerChannelReporter.from<MyChannel>(parentPort)
```

**Constructor:**

```ts
// For custom message posting logic
const report = new WorkerChannelReporter<MyChannel>((message) => {
  parentPort.postMessage(message)
})
```

#### Usage

```ts
// Events (one-time only)
report.event.eventName(payload)

// Streams (multiple emissions + end)
report.stream.streamName.emit(payload)
report.stream.streamName.emit(anotherPayload)
report.stream.streamName.end()
```

### `WorkerChannelReceiver`

Receives events and streams from worker in the parent process.

#### Creation

**Static factory (recommended):**

```ts
// Automatically detects the interface type and sets up listeners
const receiver = WorkerChannelReceiver.from<MyChannel>(worker)
```

**Constructor:**

```ts
// For custom subscription logic
const receiver = new WorkerChannelReceiver<MyChannel>((subscriber) => {
  worker.addListener('message', subscriber.next)
  worker.addListener('error', subscriber.error)

  // Return cleanup function
  return () => {
    worker.removeListener('message', subscriber.next)
    worker.removeListener('error', subscriber.error)
  }
})
```

#### Usage

```ts
// Events (returns Promise that resolves once)
const payload = await receiver.event.eventName()

// Streams (returns AsyncIterable for multiple values)
for await (const payload of receiver.stream.streamName()) {
  console.log('Received:', payload)
}

// Cleanup (important for static factory instances)
receiver.unsubscribe()
```

#### Error Propagation

When an error occurs in the worker thread, it automatically propagates to any awaiting event handlers or stream iterators in the parent process:

```ts
// If the worker throws an error...
// worker.ts
throw new Error('Something went wrong in worker')
```

```ts
// ...it will reject awaiting promises in the parent
// main.ts
try {
  const result = await receiver.event.completed() // ← Will reject with worker error
} catch (error) {
  console.error('Worker failed:', error.message) // "Something went wrong in worker"
}

// ...and cause stream iteration to throw
try {
  for await (const progress of receiver.stream.progress()) {
    // ← Will throw worker error
    console.log(progress)
  }
} catch (error) {
  console.error('Stream failed:', error.message) // "Something went wrong in worker"
}
```

This eliminates the need for manual error handling patterns like `worker.on('error', ...)` - errors are automatically propagated to the appropriate awaiting code.

## Important Caveats

### Events are one-time only

```ts
// ❌ This will throw an error
reporter.event.buildComplete({duration: 1000})
reporter.event.buildComplete({duration: 2000}) // Error: already reported

// ✅ Use streams for multiple values instead
reporter.stream.status.emit('processing')
reporter.stream.status.emit('finalizing')
reporter.stream.status.end()
```

> [!NOTE]
> This design prevents bugs where the same event fires multiple times unexpectedly. It makes the contract explicit: use events for singular occurrences, streams for continuous data.

### Streams must be ended

```ts
// ❌ Stream never ends - receiver will wait forever
reporter.stream.progress.emit(50)
reporter.stream.progress.emit(100)
// Missing: reporter.stream.progress.end()

// ✅ Always end streams
reporter.stream.progress.emit(50)
reporter.stream.progress.emit(100)
reporter.stream.progress.end() // Signals completion
```

### Control flow must match between worker and parent

The parent's control flow should mirror the worker's control flow. If a condition prevents the worker from reporting an event/stream that the parent is awaiting, the parent will hang indefinitely:

```ts
// ❌ Worker may conditionally skip events
// worker.ts
if (shouldProcess) {
  report.event.started({count: files.length})
  // ... processing
  report.event.finished({success: true})
}
// If shouldProcess is false, no events are sent

// ❌ Parent unconditionally awaits - will hang if worker skips
// main.ts
await receiver.event.started() // ← Will hang forever if shouldProcess is false
// ...
await receiver.event.finished()
```

```ts
// ✅ Match the conditional logic or use different events
// worker.ts
if (shouldProcess) {
  report.event.started({count: files.length})
  // ... processing
  report.event.finished({success: true})
} else {
  report.event.skipped({reason: 'No processing needed'})
}

// ✅ Parent handles both cases
// main.ts
const startResult = await Promise.race([
  receiver.event.started().then((data) => ({type: 'started', data})),
  receiver.event.skipped().then((data) => ({type: 'skipped', data})),
])

if (startResult.type === 'started') {
  // ... handle processing flow
  await receiver.event.finished()
} else {
  console.log('Processing skipped:', startResult.data.reason)
}
```

> [!WARNING]
> Worker channels provide message routing, not flow validation. The library doesn't verify that events are sent in the expected order or that all expected events are sent - it only ensures messages reach the right handlers when they are sent.

## LICENSE

MIT License - see [LICENSE](./LICENSE) file for details.
