import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaForFile, mediaTypeForPath } from './tools.mjs'

test('mediaTypeForPath recognises images, audio and PDFs case-insensitively', () => {
  assert.deepEqual(mediaTypeForPath('shot.PNG'), { kind: 'image', mimeType: 'image/png' })
  assert.deepEqual(mediaTypeForPath('assets/photo.jpeg'), { kind: 'image', mimeType: 'image/jpeg' })
  assert.deepEqual(mediaTypeForPath('voice.mp3'), { kind: 'audio', mimeType: 'audio/mpeg' })
  assert.deepEqual(mediaTypeForPath('notes.M4A'), { kind: 'audio', mimeType: 'audio/mp4' })
  assert.deepEqual(mediaTypeForPath('report.pdf'), { kind: 'document', mimeType: 'application/pdf' })
  assert.equal(mediaTypeForPath('main.ts'), null)
  assert.equal(mediaTypeForPath('README'), null)
})

test('mediaForFile returns base64 that round-trips and keeps the file name', () => {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03])
  const media = mediaForFile('assets/shot.png', buffer)
  assert.equal(media.kind, 'image')
  assert.equal(media.mimeType, 'image/png')
  assert.equal(media.name, 'shot.png')
  assert.deepEqual(Buffer.from(media.data, 'base64'), buffer)
})

test('mediaForFile refuses text and oversized media', () => {
  assert.equal(mediaForFile('notes.txt', Buffer.from('hello')), null)
  assert.equal(mediaForFile('shot.png', Buffer.alloc(5 * 1024 * 1024 + 1)), null)
})
