import React, { useState } from 'react';
import './CodeBlock.css';

/**
 * CodeBlock component for displaying code with syntax highlighting and a copy button
 * @param {Object} props - Component props
 * @param {string} props.children - The code content
 * @param {string} props.language - The programming language (optional)
 * @returns {JSX.Element} - Rendered component
 */
const CodeBlock = ({ children, language }) => {
  const [copied, setCopied] = useState(false);
  
  // Handle copy button click
  const handleCopy = () => {
    // Copy text to clipboard
    navigator.clipboard.writeText(children)
      .then(() => {
        setCopied(true);
        // Reset copied state after 2 seconds
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => {
        console.error('Failed to copy code: ', err);
      });
  };

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        {language && <span className="code-language">{language}</span>}
        <button 
          className={`copy-button ${copied ? 'copied' : ''}`} 
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="code-block">
        <code className={language ? `language-${language}` : ''}>
          {children}
        </code>
      </pre>
    </div>
  );
};

export default CodeBlock;
