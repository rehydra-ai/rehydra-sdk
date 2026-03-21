import { describe, it, expect } from 'vitest';
import { connectionStringRecognizer } from '../../../src/recognizers/secrets/connection-string.js';
import { PIIType, DetectionSource } from '../../../src/types/index.js';

describe('Connection String Recognizer', () => {
  describe('find', () => {
    it('should detect postgres connection strings', () => {
      const text = 'DATABASE_URL=postgres://admin:s3cretP4ss@db.example.com:5432/mydb';
      const matches = connectionStringRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        type: PIIType.CONNECTION_STRING,
        source: DetectionSource.REGEX,
      });
      expect(matches[0]?.text).toContain('postgres://admin:s3cretP4ss@');
    });

    it('should detect postgresql connection strings', () => {
      const text = 'url = postgresql://user:hunter2hunt@localhost/testdb';
      const matches = connectionStringRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toContain('postgresql://');
    });

    it('should detect mongodb+srv connection strings', () => {
      const text = 'MONGO_URI=mongodb+srv://dbuser:MyP4ssw0rd@cluster0.mongodb.net/app';
      const matches = connectionStringRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toContain('mongodb+srv://');
    });

    it('should detect redis connection strings', () => {
      const text = 'REDIS_URL=redis://default:r3disP4ss@redis.example.com:6379';
      const matches = connectionStringRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toContain('redis://');
    });

    it('should detect mysql connection strings', () => {
      const text = 'mysql://root:mySqlP4ss@db-host.example.com/production';
      const matches = connectionStringRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toContain('mysql://');
    });

    it('should not match URIs without credentials', () => {
      const texts = [
        'postgres://host/db',
        'redis://localhost:6379',
        'mongodb://host/db',
      ];

      for (const text of texts) {
        const matches = connectionStringRecognizer.find(text);
        expect(matches).toHaveLength(0);
      }
    });

    it('should provide correct offsets', () => {
      const connStr = 'postgres://admin:s3cretP4ss@db.example.com/mydb';
      const text = `URL: ${connStr} end`;
      const matches = connectionStringRecognizer.find(text);

      expect(matches).toHaveLength(1);
      expect(matches[0]?.start).toBe(5);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(connStr);
    });
  });

  describe('validate', () => {
    it('should reject placeholder passwords', () => {
      expect(connectionStringRecognizer.validate!('postgres://user:password@host/db')).toBe(false);
      expect(connectionStringRecognizer.validate!('postgres://user:changeme@host/db')).toBe(false);
      expect(connectionStringRecognizer.validate!('postgres://user:secret@host/db')).toBe(false);
    });

    it('should reject very short passwords', () => {
      expect(connectionStringRecognizer.validate!('postgres://user:ab@host/db')).toBe(false);
    });

    it('should accept real-looking passwords', () => {
      expect(connectionStringRecognizer.validate!('postgres://user:s3cretP4ss@host/db')).toBe(true);
    });

    it('should reject strings without credentials pattern', () => {
      expect(connectionStringRecognizer.validate!('postgres://host/db')).toBe(false);
    });
  });
});
