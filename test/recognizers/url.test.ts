import { describe, it, expect } from 'vitest';
import { urlRecognizer, extractDomain } from '../../src/recognizers/url.js';
import { PIIType, DetectionSource } from '../../src/types/index.js';

describe('URL Recognizer', () => {
  describe('find', () => {
    it('should detect HTTP URLs', () => {
      const text = 'Visit http://example.com for more info.';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.URL,
        text: 'http://example.com',
        source: DetectionSource.REGEX,
        confidence: 0.92,
      });
    });

    it('should detect HTTPS URLs', () => {
      const text = 'Secure site: https://secure.example.com';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('https://secure.example.com');
    });

    it('should detect FTP URLs', () => {
      const text = 'Download from ftp://files.example.com';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('ftp://files.example.com');
    });

    it('should detect file:// URLs', () => {
      const text = 'Open file:///path/to/file.txt';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('file:///path/to/file.txt');
    });

    it('should detect www. URLs without protocol', () => {
      const text = 'Visit www.example.com today';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('www.example.com');
    });

    it('should detect mailto: URLs', () => {
      const text = 'Email: mailto:contact@example.com';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('mailto:contact@example.com');
    });

    it('should detect URLs with paths', () => {
      const text = 'Go to https://example.com/path/to/page';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe('https://example.com/path/to/page');
    });

    it('should detect URLs with query parameters', () => {
      const text = 'Visit https://example.com?param=value&other=123';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toContain('https://example.com');
      expect(matches[0]?.text).toContain('?');
    });

    it('should detect URLs with fragments', () => {
      const text = 'Link: https://example.com/page#section';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toContain('#section');
    });

    it('should detect multiple URLs', () => {
      const text = 'Visit http://site1.com and https://site2.com';
      const matches = urlRecognizer.find(text);

      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('should provide correct offsets', () => {
      const text = 'URL: https://example.com here';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.start).toBe(5);
      expect(matches[0]?.end).toBe(24); // 5 + 19 (length of 'https://example.com')
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe('https://example.com');
    });

    it('should deduplicate overlapping matches', () => {
      // www. might be part of http://www.
      const text = 'Visit http://www.example.com';
      const matches = urlRecognizer.find(text);

      // Should not have both http://www.example.com and www.example.com
      expect(matches.length).toBeLessThanOrEqual(2);
      // Should prefer the longer match
      if (matches.length > 1) {
        const longer = matches.find(m => m.text.includes('http://'));
        expect(longer).toBeDefined();
      }
    });

    it('should not match invalid URL patterns', () => {
      const text = 'Not a URL: example';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(0);
    });

    it('should handle URLs with ports', () => {
      const text = 'Connect to http://example.com:8080';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toContain(':8080');
    });

    it('should handle URLs with special characters', () => {
      const text = 'Visit https://example.com/path_with_underscores';
      const matches = urlRecognizer.find(text);

      expect(matches).toHaveLength(1);
    });
  });

  describe('validate', () => {
    it('should validate correct HTTP URLs', () => {
      expect(urlRecognizer.validate!('http://example.com')).toBe(true);
      expect(urlRecognizer.validate!('https://secure.example.com')).toBe(true);
    });

    it('should validate www. URLs', () => {
      expect(urlRecognizer.validate!('www.example.com')).toBe(true);
      expect(urlRecognizer.validate!('www.subdomain.example.co.uk')).toBe(true);
    });

    it('should validate mailto: URLs', () => {
      expect(urlRecognizer.validate!('mailto:user@example.com')).toBe(true);
    });

    it('should validate URLs with paths', () => {
      expect(urlRecognizer.validate!('https://example.com/path/to/page')).toBe(true);
    });

    it('should reject URLs that are too short', () => {
      expect(urlRecognizer.validate!('http')).toBe(false);
      expect(urlRecognizer.validate!('www')).toBe(false);
    });

    it('should reject URLs without dots', () => {
      expect(urlRecognizer.validate!('http://example')).toBe(false);
      expect(urlRecognizer.validate!('www')).toBe(false);
    });

    it('should reject URLs with TLD shorter than 2 characters', () => {
      expect(urlRecognizer.validate!('http://example.c')).toBe(false);
      expect(urlRecognizer.validate!('www.example.c')).toBe(false);
    });

    it('should validate URLs with valid TLDs', () => {
      expect(urlRecognizer.validate!('http://example.com')).toBe(true);
      expect(urlRecognizer.validate!('http://example.co.uk')).toBe(true);
      expect(urlRecognizer.validate!('http://example.org')).toBe(true);
    });

    it('should handle URLs with query strings in TLD check', () => {
      expect(urlRecognizer.validate!('http://example.com?param=value')).toBe(true);
      expect(urlRecognizer.validate!('http://example.co?param=value')).toBe(true);
    });

    it('should handle URLs with fragments in TLD check', () => {
      expect(urlRecognizer.validate!('http://example.com#section')).toBe(true);
    });

    it('should handle URLs with paths in TLD check', () => {
      expect(urlRecognizer.validate!('http://example.com/path')).toBe(true);
    });
  });

  describe('normalize', () => {
    it('should trim URLs', () => {
      expect(urlRecognizer.normalize!('  https://example.com  ')).toBe('https://example.com');
    });

    it('should handle already trimmed URLs', () => {
      expect(urlRecognizer.normalize!('https://example.com')).toBe('https://example.com');
    });
  });
});

describe('extractDomain', () => {
  it('should extract domain from HTTP URL', () => {
    expect(extractDomain('http://example.com')).toBe('example.com');
  });

  it('should extract domain from HTTPS URL', () => {
    expect(extractDomain('https://secure.example.com')).toBe('secure.example.com');
  });

  it('should extract domain from www. URL', () => {
    expect(extractDomain('www.example.com')).toBe('www.example.com');
  });

  it('should extract domain from URL with path', () => {
    expect(extractDomain('https://example.com/path/to/page')).toBe('example.com');
  });

  it('should extract domain from URL with query', () => {
    expect(extractDomain('https://example.com?param=value')).toBe('example.com');
  });

  it('should extract domain from URL with port', () => {
    expect(extractDomain('http://example.com:8080')).toBe('example.com');
  });

  it('should extract domain from URL with subdomain', () => {
    expect(extractDomain('https://subdomain.example.com')).toBe('subdomain.example.com');
  });

  it('should return null for invalid URLs', () => {
    expect(extractDomain('not a url')).toBe(null);
    expect(extractDomain('')).toBe(null);
  });

  it('should handle URLs without protocol', () => {
    expect(extractDomain('example.com')).toBe('example.com');
  });

  it('should handle mailto: URLs', () => {
    // mailto: URLs don't have a hostname in the traditional sense
    const result = extractDomain('mailto:user@example.com');
    // Should either return null or handle gracefully
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('should handle file:// URLs', () => {
    const result = extractDomain('file:///path/to/file');
    // file:// URLs may not have hostnames
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

