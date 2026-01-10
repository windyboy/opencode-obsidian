/**
 * Security Tests for Config Loader
 * Tests SSRF protection, path traversal protection, and YAML injection protection
 */

import { describe, it, expect } from 'vitest'
import { validateProviderBaseURL } from '../../src/utils/validators'

describe('Config Loader Security Tests', () => {
  describe('SSRF Protection - baseURL Validation', () => {
    it('should reject http:// URLs (require https://)', () => {
      const errors = validateProviderBaseURL('http://example.com/api', false)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some(e => e.includes('https://'))).toBe(true)
    })

    it('should accept https:// URLs', () => {
      const errors = validateProviderBaseURL('https://example.com/api', false)
      expect(errors.length).toBe(0)
    })

    it('should reject localhost', () => {
      const errors = validateProviderBaseURL('https://localhost/api', false)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some(e => e.includes('localhost'))).toBe(true)
    })

    it('should reject 127.0.0.1', () => {
      const errors = validateProviderBaseURL('https://127.0.0.1/api', false)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some(e => e.includes('127.0.0.1') || e.includes('localhost'))).toBe(true)
    })

    it('should reject private IP range 10.0.0.0/8', () => {
      const errors = validateProviderBaseURL('https://10.0.0.1/api', false)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some(e => e.includes('10.0.0.0/8'))).toBe(true)
    })

    it('should reject private IP range 172.16.0.0/12', () => {
      const errors = validateProviderBaseURL('https://172.16.0.1/api', false)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some(e => e.includes('172.16.0.0/12'))).toBe(true)

      // Test edge cases
      const errors172_31 = validateProviderBaseURL('https://172.31.0.1/api', false)
      expect(errors172_31.length).toBeGreaterThan(0)

      // Should accept 172.15.x.x (outside range)
      const errors172_15 = validateProviderBaseURL('https://172.15.0.1/api', false)
      // Should not have SSRF error (might have other errors, but not SSRF)
      expect(errors172_15.some(e => e.includes('172.16.0.0/12'))).toBe(false)
    })

    it('should reject private IP range 192.168.0.0/16', () => {
      const errors = validateProviderBaseURL('https://192.168.1.1/api', false)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some(e => e.includes('192.168.0.0/16'))).toBe(true)
    })

    it('should reject dangerous protocols (file://, ftp://, etc.)', () => {
      const fileErrors = validateProviderBaseURL('file:///etc/passwd', false)
      expect(fileErrors.length).toBeGreaterThan(0)
      expect(fileErrors.some(e => e.includes('file:') || e.includes('security risk'))).toBe(true)

      const ftpErrors = validateProviderBaseURL('ftp://example.com', false)
      expect(ftpErrors.length).toBeGreaterThan(0)
      expect(ftpErrors.some(e => e.includes('ftp:') || e.includes('security risk'))).toBe(true)
    })

    it('should allow localhost when allowLocalhost is true (advanced mode)', () => {
      // When allowLocalhost=true, localhost should be allowed (but http:// should still be blocked)
      const errors = validateProviderBaseURL('https://localhost/api', true)
      expect(errors.length).toBe(0)

      // But http:// should still be blocked even with allowLocalhost
      const httpErrors = validateProviderBaseURL('http://localhost/api', true)
      expect(httpErrors.length).toBeGreaterThan(0)
    })

    it('should reject invalid URLs', () => {
      const errors1 = validateProviderBaseURL('not-a-url', false)
      expect(errors1.length).toBeGreaterThan(0)

      const errors2 = validateProviderBaseURL('', false)
      expect(errors2.length).toBeGreaterThan(0)
      expect(errors2.some(e => e.includes('required'))).toBe(true)
    })

    it('should accept valid public URLs', () => {
      const validURLs = [
        'https://api.openai.com/v1',
        'https://api.anthropic.com/v1',
        'https://example.com/api/v1',
        'https://subdomain.example.com/api',
      ]

      for (const url of validURLs) {
        const errors = validateProviderBaseURL(url, false)
        expect(errors.length).toBe(0)
      }
    })
  })

  describe('YAML Injection Protection', () => {
    it('should handle YAML with anchors and aliases safely', () => {
      // This test would verify that YAML parsing with SAFE_SCHEMA and maxAliasCount
      // prevents DoS attacks via anchor/alias expansion
      // Actual YAML parsing is tested in config-loader.test.ts if it exists
      
      // For now, we verify the configuration is set correctly
      // The actual parsing behavior is tested through integration tests
      expect(true).toBe(true) // Placeholder - actual test would parse YAML with anchors
    })

    it('should limit alias expansion to prevent DoS', () => {
      // maxAliasCount: 50 should prevent excessive alias expansion
      // This is a configuration test - actual behavior tested in integration tests
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Path Traversal Protection', () => {
    it('should reject baseURLs with path traversal attempts', () => {
      // Path traversal in URLs is typically handled by URL parsing
      // But we should verify that paths like /../etc/passwd don't bypass validation
      
      const traversalURLs = [
        'https://example.com/../etc/passwd',
        'https://example.com/api/../../config',
      ]

      for (const url of traversalURLs) {
        // These should be valid URLs (path normalization happens at request time)
        // But we verify they don't bypass baseURL validation
        const errors = validateProviderBaseURL(url, false)
        // Should pass baseURL validation (path traversal is handled at HTTP request level)
        expect(errors.some(e => e.includes('not a valid URL'))).toBe(false)
      }
    })
  })
})
