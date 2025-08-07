import {EventEmitter} from 'node:events'
import {describe, it, expect, beforeEach, vi} from 'vitest'
import {
  WorkerChannel,
  WorkerChannelReceiver,
  WorkerChannelReporter,
  isWorkerChannelMessage,
} from './index'

// Test channel definition
type TestDefinition = WorkerChannel.Definition<{
  testEvent: WorkerChannel.Event<string>
  testStream: WorkerChannel.Stream<number>
}>

async function fromAsync<T>(asyncIterable: AsyncIterable<T>) {
  const items: T[] = []
  for await (const item of asyncIterable) {
    items.push(item)
  }
  return items
}

describe('WorkerChannel', () => {
  let reporter: WorkerChannelReporter<TestDefinition>
  let receiver: WorkerChannelReceiver<TestDefinition>

  beforeEach(() => {
    const emitter = new EventEmitter()
    reporter = WorkerChannelReporter.from<TestDefinition>(emitter)
    receiver = WorkerChannelReceiver.from<TestDefinition>(emitter)
  })

  describe('Event handling', () => {
    it('should report and receive events', async () => {
      reporter.event.testEvent('hello')
      const result = await receiver.event.testEvent()
      expect(result).toBe('hello')
    })

    it('should throw when reporting same event twice', () => {
      reporter.event.testEvent('first')
      expect(() => reporter.event.testEvent('second')).toThrow(
        /Cannot report event "testEvent" because it has already been reported./,
      )
    })

    it('should handle error events and reject awaiting event promises (EventTarget)', async ({
      skip,
    }) => {
      if (typeof CustomEvent === 'undefined') skip()

      const eventTarget = new EventTarget()
      const receiver = WorkerChannelReceiver.from<TestDefinition>(eventTarget)

      const testError = new Error('Test error')

      // Start waiting for event
      const eventPromise = receiver.event.testEvent()

      // Dispatch error event
      eventTarget.dispatchEvent(new CustomEvent('error', {detail: testError}))

      // The promise should reject with the CustomEvent (not the inner error)
      await expect(eventPromise).rejects.toBe(testError)
    })

    it('should handle error events and reject awaiting event promises (EventEmitter)', async () => {
      const emitter = new EventEmitter()
      const receiver = WorkerChannelReceiver.from<TestDefinition>(emitter)

      const testError = new Error('Test error')

      // Start waiting for event
      const eventPromise = receiver.event.testEvent()

      // Emit error event
      emitter.emit('error', testError)

      // The promise should reject with the error directly
      await expect(eventPromise).rejects.toBe(testError)
    })
  })

  describe('Stream handling', () => {
    it('should emit and receive stream values', async () => {
      const resultsPromise = fromAsync(receiver.stream.testStream())
      const streamReporter = reporter.stream.testStream
      streamReporter.emit(1)
      streamReporter.emit(2)
      streamReporter.end()

      await expect(resultsPromise).resolves.toEqual([1, 2])
    })

    it('should not hang if stream ends before any items are emitted', async () => {
      const resultsPromise = fromAsync(receiver.stream.testStream())
      const streamReporter = reporter.stream.testStream
      streamReporter.end()

      await expect(resultsPromise).resolves.toEqual([])
    })

    it('should throw when emitting after stream end', () => {
      const streamReporter = reporter.stream.testStream
      streamReporter.end()
      expect(() => streamReporter.emit(1)).toThrow(
        /Cannot emit to stream "testStream" because it has already been finished./,
      )
    })

    it('should throw when ending stream twice', () => {
      const streamReporter = reporter.stream.testStream
      streamReporter.end()
      expect(() => streamReporter.end()).toThrow(
        /Cannot end stream "testStream" because it has already been finished./,
      )
    })

    it('should handle error events and propagate to stream buffer (EventTarget)', async ({
      skip,
    }) => {
      if (typeof CustomEvent === 'undefined') skip()

      const eventTarget = new EventTarget()
      const receiver = WorkerChannelReceiver.from<TestDefinition>(eventTarget)

      const testError = new Error('Stream error')

      // Start consuming stream
      const streamResults = fromAsync(receiver.stream.testStream())

      // Dispatch error event
      eventTarget.dispatchEvent(new CustomEvent('error', {detail: testError}))

      // The stream should throw with the CustomEvent when trying to iterate
      await expect(streamResults).rejects.toMatchObject(testError)
    })

    it('should handle error events and propagate to stream buffer (EventEmitter)', async () => {
      const emitter = new EventEmitter()
      const receiver = WorkerChannelReceiver.from<TestDefinition>(emitter)

      const testError = new Error('Stream error')

      // Start consuming stream
      const streamResults = fromAsync(receiver.stream.testStream())

      // Emit error event
      emitter.emit('error', testError)

      // The stream should throw with the error directly when trying to iterate
      await expect(streamResults).rejects.toBe(testError)
    })
  })

  describe('Message filtering', () => {
    it('should ignore non-worker-channel messages', async () => {
      const emitter = new EventEmitter()
      const receiver = WorkerChannelReceiver.from<TestDefinition>(emitter)

      // These should all be ignored
      const invalidMessages = [
        null,
        undefined,
        'string message',
        123,
        true,
        {},
        {type: 'invalid'},
        {type: 123},
        {name: 'test', payload: 'data'}, // missing type
        {type: 'unknown', name: 'test', payload: 'data'}, // invalid type
      ]

      // Dispatch all invalid messages
      for (const message of invalidMessages) {
        emitter.emit('message', message)
      }

      // These invalid messages should not affect normal operation
      // Send a valid message and verify it works
      emitter.emit('message', {
        // NOTE: this is wrapped in `data` to simulate how Web Workers get data
        // from the message event
        data: {type: 'channel-event', name: 'testEvent', payload: 'valid'},
      })

      const result = await receiver.event.testEvent()
      expect(result).toBe('valid')
    })
  })

  describe('WorkerChannelReceiver.from factory', () => {
    it('should work with EventEmitter (addListener interface)', async () => {
      const emitter = new EventEmitter()
      const receiver = WorkerChannelReceiver.from<TestDefinition>(emitter)

      // Test that it works
      emitter.emit('message', {type: 'channel-event', name: 'testEvent', payload: 'from-emitter'})

      const result = await receiver.event.testEvent()
      expect(result).toBe('from-emitter')

      receiver.unsubscribe()
    })

    it('should work with EventTarget (addEventListener interface)', async ({skip}) => {
      if (typeof CustomEvent === 'undefined') skip()

      const eventTarget = new EventTarget()
      const receiver = WorkerChannelReceiver.from<TestDefinition>(eventTarget)

      // Test that it works
      eventTarget.dispatchEvent(
        new CustomEvent('message', {
          detail: {type: 'channel-event', name: 'testEvent', payload: 'from-target'},
        }),
      )

      const result = await receiver.event.testEvent()
      expect(result).toBe('from-target')

      receiver.unsubscribe()
    })

    it('should throw TypeError for objects that implement neither interface', () => {
      const invalidWorker = {
        someOtherMethod: () => {},
      }

      expect(() => {
        WorkerChannelReceiver.from(invalidWorker as any)
      }).toThrow(TypeError)
      expect(() => {
        WorkerChannelReceiver.from(invalidWorker as any)
      }).toThrow(/requires a worker that implements either the EventEmitter.*or EventTarget/)
    })

    it('should properly clean up EventEmitter listeners', () => {
      const emitter = new EventEmitter()
      const addListenerSpy = vi.spyOn(emitter, 'addListener')
      const removeListenerSpy = vi.spyOn(emitter, 'removeListener')

      const receiver = WorkerChannelReceiver.from<TestDefinition>(emitter)

      // Verify listeners were added
      expect(addListenerSpy).toHaveBeenCalledWith('message', expect.any(Function))
      expect(addListenerSpy).toHaveBeenCalledWith('error', expect.any(Function))

      // Unsubscribe and verify listeners were removed
      receiver.unsubscribe()

      expect(removeListenerSpy).toHaveBeenCalledWith('message', expect.any(Function))
      expect(removeListenerSpy).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('should properly clean up EventTarget listeners', () => {
      const eventTarget = new EventTarget()
      const addEventListenerSpy = vi.spyOn(eventTarget, 'addEventListener')
      const removeEventListenerSpy = vi.spyOn(eventTarget, 'removeEventListener')

      const receiver = WorkerChannelReceiver.from<TestDefinition>(eventTarget)

      // Verify listeners were added
      expect(addEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function))
      expect(addEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function))

      // Unsubscribe and verify listeners were removed
      receiver.unsubscribe()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('error', expect.any(Function))
    })
  })

  describe('WorkerChannelReporter.from factory', () => {
    it('should throw error when parentPort is null', () => {
      expect(() => {
        WorkerChannelReporter.from(null)
      }).toThrow(/requires a valid parent port.*received: null/)
    })

    it('should work with ParentPortLike (postMessage interface)', () => {
      const mockParentPort = {
        postMessage: vi.fn(),
      }

      const reporter = WorkerChannelReporter.from<TestDefinition>(mockParentPort)

      reporter.event.testEvent('test-message')

      expect(mockParentPort.postMessage).toHaveBeenCalledWith({
        type: 'channel-event',
        name: 'testEvent',
        payload: 'test-message',
      })
    })

    it('should work with EventTarget (dispatchEvent interface)', ({skip}) => {
      if (typeof CustomEvent === 'undefined') skip()

      const eventTarget = new EventTarget()
      const dispatchEventSpy = vi.spyOn(eventTarget, 'dispatchEvent')

      const reporter = WorkerChannelReporter.from<TestDefinition>(eventTarget)

      reporter.event.testEvent('test-message')

      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          detail: {
            type: 'channel-event',
            name: 'testEvent',
            payload: 'test-message',
          },
        }),
      )
    })

    it('should work with EventEmitter (emit interface)', () => {
      const emitter = new EventEmitter()
      const emitSpy = vi.spyOn(emitter, 'emit')

      const reporter = WorkerChannelReporter.from<TestDefinition>(emitter)

      reporter.event.testEvent('test-message')

      expect(emitSpy).toHaveBeenCalledWith('message', {
        type: 'channel-event',
        name: 'testEvent',
        payload: 'test-message',
      })
    })

    it('should throw TypeError for objects that implement none of the supported interfaces', () => {
      const invalidParentPort = {
        someOtherMethod: () => {},
      }

      expect(() => {
        WorkerChannelReporter.from(invalidParentPort as any)
      }).toThrow(TypeError)
      expect(() => {
        WorkerChannelReporter.from(invalidParentPort as any)
      }).toThrow(/requires a parent port that implements one of the supported interfaces/)
    })
  })

  describe('isWorkerChannelMessage', () => {
    it('should return true for valid WorkerChannelMessage objects', () => {
      const validMessages = [
        {type: 'channel-event', name: 'test', payload: 'data'},
        {type: 'channel-emission', name: 'stream', payload: {value: 1}},
        {type: 'channel-end', name: 'stream'},
      ]

      for (const message of validMessages) {
        expect(isWorkerChannelMessage(message)).toBe(true)
      }
    })

    it('should return false for invalid messages', () => {
      const invalidMessages = [
        null,
        undefined,
        'string',
        123,
        true,
        [],
        {},
        {type: 'invalid'},
        {type: 123},
        {name: 'test', payload: 'data'}, // missing type
        {type: 'unknown', name: 'test', payload: 'data'}, // invalid type
      ]

      for (const message of invalidMessages) {
        expect(isWorkerChannelMessage(message)).toBe(false)
      }
    })
  })

  describe('Proxy symbol handling', () => {
    let reporter: WorkerChannelReporter<TestDefinition>
    let receiver: WorkerChannelReceiver<TestDefinition>

    beforeEach(() => {
      const emitter = new EventEmitter()
      reporter = WorkerChannelReporter.from<TestDefinition>(emitter)
      receiver = WorkerChannelReceiver.from<TestDefinition>(emitter)
    })

    it('should return undefined when accessing event reporters with symbols', () => {
      const testSymbol = Symbol('test')
      expect((reporter.event as any)[testSymbol]).toBeUndefined()
    })

    it('should return undefined when accessing stream reporters with symbols', () => {
      const testSymbol = Symbol('test')
      expect((reporter.stream as any)[testSymbol]).toBeUndefined()
    })

    it('should return undefined when accessing event receivers with symbols', () => {
      const testSymbol = Symbol('test')
      expect((receiver.event as any)[testSymbol]).toBeUndefined()
    })

    it('should return undefined when accessing stream receivers with symbols', () => {
      const testSymbol = Symbol('test')
      expect((receiver.stream as any)[testSymbol]).toBeUndefined()
    })
  })
})
