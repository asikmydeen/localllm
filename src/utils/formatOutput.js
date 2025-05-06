/**
 * Utility functions for formatting different types of output content
 */

/**
 * Detects the type of content in the text
 * @param {string} text - The text to analyze
 * @returns {string} - The detected content type ('markdown', 'json', 'code', 'text')
 */
export function detectContentType(text) {
  if (!text || typeof text !== 'string') {
    return 'text';
  }

  // Check if it's JSON
  if ((text.trim().startsWith('{') && text.trim().endsWith('}')) || 
      (text.trim().startsWith('[') && text.trim().endsWith(']'))) {
    try {
      JSON.parse(text);
      return 'json';
    } catch (e) {
      // Not valid JSON
    }
  }

  // Check for code blocks (markdown style)
  if (text.includes('```')) {
    return 'markdown';
  }

  // Check for markdown indicators
  const markdownIndicators = [
    /^#+ /m,        // Headers
    /\*\*.+\*\*/,   // Bold
    /\*.+\*/,       // Italic
    /\[.+\]\(.+\)/, // Links
    /^\s*[-*+] /m,  // Lists
    /^\s*\d+\. /m,  // Numbered lists
    /^\s*>/m,       // Blockquotes
    /\|.+\|.+\|/    // Tables
  ];

  for (const pattern of markdownIndicators) {
    if (pattern.test(text)) {
      return 'markdown';
    }
  }

  return 'text';
}

/**
 * Format the output content based on its type
 * @param {string} content - The content to format
 * @returns {Object} - Object with formatted content and type
 */
export function formatOutput(content) {
  if (!content) {
    return { formattedContent: '', type: 'text' };
  }

  const contentType = detectContentType(content);

  switch (contentType) {
    case 'json':
      try {
        // Format JSON with proper indentation
        const parsedJson = JSON.parse(content);
        const formattedJson = JSON.stringify(parsedJson, null, 2);
        return {
          formattedContent: formattedJson,
          type: 'json'
        };
      } catch (e) {
        // If JSON parsing fails, treat as text
        return { formattedContent: content, type: 'text' };
      }
    
    case 'markdown':
      // Return as is, will be rendered as markdown
      return { formattedContent: content, type: 'markdown' };
    
    default:
      return { formattedContent: content, type: 'text' };
  }
}
