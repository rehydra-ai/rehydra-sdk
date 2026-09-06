import type { Recognizer } from '../recognizers/base.js';
import { extractTagsStrict } from '../pipeline/tagger.js';
import type { TagFormat } from '../types/index.js';

/** Keep repeated history transforms from discovering an existing tag as a name. */
export function protectIdentityTags(recognizer: Recognizer, format: TagFormat): Recognizer {
  return {
    ...recognizer,
    find(text): ReturnType<Recognizer['find']> {
      const tags = extractTagsStrict(text, format);
      if (tags.length === 0) return recognizer.find(text);
      const pieces: string[] = [];
      let offset = 0;
      for (const tag of tags) {
        pieces.push(text.slice(offset, tag.position), ' '.repeat(tag.matchedText.length));
        offset = tag.position + tag.matchedText.length;
      }
      pieces.push(text.slice(offset));
      return recognizer.find(pieces.join('')).filter(match =>
        !tags.some(tag => match.start < tag.position + tag.matchedText.length && match.end > tag.position),
      );
    },
  };
}
