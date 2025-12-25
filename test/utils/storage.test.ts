import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as nodePath from "path";
import {
  join,
  dirname,
  basename,
  normalize,
  extname,
  isAbsolute,
} from "../../src/utils/path.js";
import {
  isNode,
  isBrowser,
  isWebWorker,
  getStorageProvider,
  resetStorageProvider,
  setStorageProvider,
  type StorageProvider,
} from "../../src/utils/storage.js";
import { NodeStorageProvider } from "../../src/utils/storage-node.js";

describe("Path Utilities", () => {
  describe("join", () => {
    it("should join path segments", () => {
      expect(join("foo", "bar", "baz")).toBe("foo/bar/baz");
      expect(join("foo", "bar/baz")).toBe("foo/bar/baz");
    });

    it("should handle leading slashes", () => {
      expect(join("/foo", "bar")).toBe("/foo/bar");
    });

    it("should handle empty segments", () => {
      expect(join("foo", "", "bar")).toBe("foo/bar");
      expect(join("", "foo", "bar")).toBe("foo/bar");
    });

    it("should normalize redundant slashes", () => {
      expect(join("foo//bar")).toBe("foo/bar");
      expect(join("foo", "//bar")).toBe("foo/bar");
    });
  });

  describe("dirname", () => {
    it("should return directory name", () => {
      expect(dirname("/foo/bar/baz.txt")).toBe("/foo/bar");
      expect(dirname("foo/bar/baz")).toBe("foo/bar");
    });

    it("should handle root paths", () => {
      expect(dirname("/foo")).toBe("/");
    });

    it("should handle paths without directories", () => {
      expect(dirname("foo")).toBe(".");
    });
  });

  describe("basename", () => {
    it("should return the base name", () => {
      expect(basename("/foo/bar/baz.txt")).toBe("baz.txt");
      expect(basename("foo/bar/baz")).toBe("baz");
    });

    it("should handle paths without directories", () => {
      expect(basename("baz.txt")).toBe("baz.txt");
    });
  });

  describe("normalize", () => {
    it("should normalize paths", () => {
      expect(normalize("foo/bar/../baz")).toBe("foo/baz");
      expect(normalize("foo/./bar")).toBe("foo/bar");
    });

    it("should handle redundant slashes", () => {
      expect(normalize("foo//bar")).toBe("foo/bar");
      expect(normalize("foo///bar")).toBe("foo/bar");
    });

    it("should handle backslashes", () => {
      expect(normalize("foo\\bar\\baz")).toBe("foo/bar/baz");
    });

    it("should preserve leading slash", () => {
      expect(normalize("/foo/bar")).toBe("/foo/bar");
    });

    it("should resolve parent directory references", () => {
      expect(normalize("foo/bar/../baz")).toBe("foo/baz");
      expect(normalize("foo/bar/../../baz")).toBe("baz");
    });

    it("should handle complex paths", () => {
      expect(normalize("./foo/../bar/./baz")).toBe("bar/baz");
    });

    it("should handle .. at root", () => {
      expect(normalize("/foo/../..")).toBe("/");
    });

    it("should handle relative paths with ..", () => {
      expect(normalize("../foo/bar")).toBe("../foo/bar");
    });
  });

  describe("extname", () => {
    it("should return file extension", () => {
      expect(extname("file.txt")).toBe(".txt");
      expect(extname("file.tar.gz")).toBe(".gz");
      expect(extname("/path/to/file.js")).toBe(".js");
    });

    it("should return empty string for files without extension", () => {
      expect(extname("file")).toBe("");
      expect(extname(".gitignore")).toBe("");
    });
  });

  describe("isAbsolute", () => {
    it("should detect absolute Unix paths", () => {
      expect(isAbsolute("/foo/bar")).toBe(true);
      expect(isAbsolute("foo/bar")).toBe(false);
    });

    it("should detect absolute Windows paths", () => {
      expect(isAbsolute("C:\\foo\\bar")).toBe(true);
      expect(isAbsolute("D:/foo/bar")).toBe(true);
    });

    it("should detect UNC paths", () => {
      expect(isAbsolute("\\\\server\\share")).toBe(true);
    });
  });
});

describe("Storage Utilities", () => {
  describe("Runtime Detection", () => {
    it("should detect Node.js environment", () => {
      // In Node.js tests, isNode should return true
      expect(isNode()).toBe(true);
      expect(isBrowser()).toBe(false);
    });

    it("should detect not in web worker", () => {
      expect(isWebWorker()).toBe(false);
    });
  });

  describe("Storage Provider", () => {
    beforeEach(() => {
      resetStorageProvider();
    });

    afterEach(() => {
      resetStorageProvider();
    });

    it("should return a storage provider", async () => {
      const provider = await getStorageProvider();
      expect(provider).toBeDefined();
      expect(typeof provider.readFile).toBe("function");
      expect(typeof provider.writeFile).toBe("function");
      expect(typeof provider.exists).toBe("function");
      expect(typeof provider.mkdir).toBe("function");
      expect(typeof provider.rm).toBe("function");
      expect(typeof provider.getCacheDir).toBe("function");
    });

    it("should return the same provider on subsequent calls", async () => {
      const provider1 = await getStorageProvider();
      const provider2 = await getStorageProvider();
      expect(provider1).toBe(provider2);
    });

    it("should return NodeStorageProvider in Node.js", async () => {
      const provider = await getStorageProvider();
      // Check that it has Node-specific behavior
      const cacheDir = provider.getCacheDir("test");
      // Node.js cache dir should be an absolute path
      expect(isAbsolute(cacheDir)).toBe(true);
    });

    it("should allow setting a custom provider", async () => {
      const mockProvider: StorageProvider = {
        readFile: async () => new Uint8Array(),
        readTextFile: async () => "mock",
        writeFile: async () => {},
        exists: async () => true,
        mkdir: async () => {},
        rm: async () => {},
        getCacheDir: () => "/mock/cache",
      };

      setStorageProvider(mockProvider);
      const provider = await getStorageProvider();
      expect(provider.getCacheDir("test")).toBe("/mock/cache");
    });
  });
});

describe("NodeStorageProvider", () => {
  let provider: NodeStorageProvider;
  let tempDir: string;

  beforeAll(async () => {
    provider = new NodeStorageProvider();
    // Create a unique temp directory for tests
    tempDir = nodePath.join(os.tmpdir(), `storage-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("readFile", () => {
    it("should read a file as Uint8Array", async () => {
      const testFile = nodePath.join(tempDir, "read-test.txt");
      await fs.writeFile(testFile, "Hello, World!");

      const result = await provider.readFile(testFile);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(result)).toBe("Hello, World!");
    });

    it("should throw for non-existent file", async () => {
      const nonExistent = nodePath.join(tempDir, "non-existent.txt");

      await expect(provider.readFile(nonExistent)).rejects.toThrow();
    });
  });

  describe("readTextFile", () => {
    it("should read a file as UTF-8 text by default", async () => {
      const testFile = nodePath.join(tempDir, "read-text-utf8.txt");
      await fs.writeFile(testFile, "Hello, World!", "utf-8");

      const result = await provider.readTextFile(testFile);

      expect(result).toBe("Hello, World!");
    });

    it("should read a file as latin1 when specified", async () => {
      const testFile = nodePath.join(tempDir, "read-text-latin1.txt");
      // Write with latin1 encoding
      await fs.writeFile(testFile, "Héllo, Wörld!", "latin1");

      const result = await provider.readTextFile(testFile, "latin1");

      expect(result).toBe("Héllo, Wörld!");
    });

    it("should throw for non-existent file", async () => {
      const nonExistent = nodePath.join(tempDir, "non-existent-text.txt");

      await expect(provider.readTextFile(nonExistent)).rejects.toThrow();
    });
  });

  describe("writeFile", () => {
    it("should write string data to a file", async () => {
      const testFile = nodePath.join(tempDir, "write-string.txt");

      await provider.writeFile(testFile, "Test content");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Test content");
    });

    it("should write Uint8Array data to a file", async () => {
      const testFile = nodePath.join(tempDir, "write-binary.bin");
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      await provider.writeFile(testFile, data);

      const content = await fs.readFile(testFile);
      expect(new Uint8Array(content)).toEqual(data);
    });

    it("should create parent directories automatically", async () => {
      const testFile = nodePath.join(tempDir, "nested", "deep", "file.txt");

      await provider.writeFile(testFile, "Nested content");

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("Nested content");
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      const testFile = nodePath.join(tempDir, "exists-test.txt");
      await fs.writeFile(testFile, "test");

      const result = await provider.exists(testFile);

      expect(result).toBe(true);
    });

    it("should return false for non-existent file", async () => {
      const nonExistent = nodePath.join(tempDir, "does-not-exist.txt");

      const result = await provider.exists(nonExistent);

      expect(result).toBe(false);
    });

    it("should return true for existing directory", async () => {
      const result = await provider.exists(tempDir);

      expect(result).toBe(true);
    });
  });

  describe("mkdir", () => {
    it("should create a directory", async () => {
      const newDir = nodePath.join(tempDir, "new-dir");

      await provider.mkdir(newDir);

      const stat = await fs.stat(newDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should create nested directories", async () => {
      const nestedDir = nodePath.join(tempDir, "deep", "nested", "dir");

      await provider.mkdir(nestedDir);

      const stat = await fs.stat(nestedDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should not throw if directory already exists", async () => {
      const existingDir = nodePath.join(tempDir, "existing-dir");
      await fs.mkdir(existingDir, { recursive: true });

      // Should not throw
      await expect(provider.mkdir(existingDir)).resolves.not.toThrow();
    });
  });

  describe("rm", () => {
    it("should remove a file", async () => {
      const testFile = nodePath.join(tempDir, "to-remove.txt");
      await fs.writeFile(testFile, "delete me");

      await provider.rm(testFile);

      await expect(fs.access(testFile)).rejects.toThrow();
    });

    it("should remove a directory with recursive option", async () => {
      const testDir = nodePath.join(tempDir, "dir-to-remove");
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(nodePath.join(testDir, "file.txt"), "content");

      await provider.rm(testDir, { recursive: true });

      await expect(fs.access(testDir)).rejects.toThrow();
    });

    it("should not throw with force option for non-existent file", async () => {
      const nonExistent = nodePath.join(tempDir, "force-remove.txt");

      await expect(
        provider.rm(nonExistent, { force: true })
      ).resolves.not.toThrow();
    });

    it("should throw without force option for non-existent file", async () => {
      const nonExistent = nodePath.join(tempDir, "no-force-remove.txt");

      await expect(provider.rm(nonExistent)).rejects.toThrow();
    });
  });

  describe("getCacheDir", () => {
    it("should return a path containing bridge-anonymization", () => {
      const cacheDir = provider.getCacheDir("models");

      expect(cacheDir).toContain("bridge-anonymization");
      expect(cacheDir).toContain("models");
    });

    it("should return different paths for different subdirs", () => {
      const modelsDir = provider.getCacheDir("models");
      const dataDir = provider.getCacheDir("semantic-data");

      expect(modelsDir).not.toBe(dataDir);
      expect(modelsDir).toContain("models");
      expect(dataDir).toContain("semantic-data");
    });

    it("should return an absolute path", () => {
      const cacheDir = provider.getCacheDir("test");

      expect(isAbsolute(cacheDir)).toBe(true);
    });

    it("should use platform-specific cache location", () => {
      const cacheDir = provider.getCacheDir("test");

      if (process.platform === "darwin") {
        expect(cacheDir).toContain("Library/Caches");
      } else if (process.platform === "win32") {
        expect(
          cacheDir.includes("AppData") || cacheDir.includes("Local")
        ).toBe(true);
      } else {
        // Linux and others
        expect(cacheDir.includes(".cache") || cacheDir.includes("XDG")).toBe(
          true
        );
      }
    });
  });

});

describe("BrowserStorageProvider (mock tests)", () => {
  // These tests verify the BrowserStorageProvider interface without actually
  // running in a browser. We test the class structure and type compatibility.

  it("should be importable", async () => {
    // This just verifies the module can be imported without errors
    const module = await import("../../src/utils/storage-browser.js");
    expect(module.BrowserStorageProvider).toBeDefined();
  });

  it("should implement StorageProvider interface", async () => {
    const module = await import("../../src/utils/storage-browser.js");
    const provider = new module.BrowserStorageProvider();

    // Check that all required methods exist
    expect(typeof provider.readFile).toBe("function");
    expect(typeof provider.readTextFile).toBe("function");
    expect(typeof provider.writeFile).toBe("function");
    expect(typeof provider.exists).toBe("function");
    expect(typeof provider.mkdir).toBe("function");
    expect(typeof provider.rm).toBe("function");
    expect(typeof provider.getCacheDir).toBe("function");
  });

  it("should return virtual cache path", async () => {
    const module = await import("../../src/utils/storage-browser.js");
    const provider = new module.BrowserStorageProvider();

    const cacheDir = provider.getCacheDir("models");

    expect(cacheDir).toBe("bridge-anonymization/models");
  });

  it("should return different virtual paths for different subdirs", async () => {
    const module = await import("../../src/utils/storage-browser.js");
    const provider = new module.BrowserStorageProvider();

    const modelsDir = provider.getCacheDir("models");
    const dataDir = provider.getCacheDir("semantic-data");

    expect(modelsDir).toBe("bridge-anonymization/models");
    expect(dataDir).toBe("bridge-anonymization/semantic-data");
  });

  it("should have mkdir as a no-op (returns void)", async () => {
    const module = await import("../../src/utils/storage-browser.js");
    const provider = new module.BrowserStorageProvider();

    // mkdir should complete without error (it's a no-op in browser)
    await expect(provider.mkdir("some/path")).resolves.toBeUndefined();
  });
});
