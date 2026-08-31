import React, { useState, useCallback, useRef, useEffect } from 'react';
import './JsonEditor.css';

/**
 * Interactive JSON Editor Component for Message Payloads
 * Supports Code View (with real-time validation, formatting, minification)
 * and Interactive Tree View (collapsible nodes, inline key-value editing,
 * type conversion, node deletion/addition).
 *
 * Props:
 *   initialValue: string — Initial JSON string or plain text
 *   onChange: (value: string, isValid: boolean) => void
 *   readOnly: boolean
 */
export default function JsonEditor({ initialValue = '', onChange, readOnly = false }) {
  const [mode, setMode] = useState('code'); // 'code' | 'tree'
  const [value, setValue] = useState(initialValue);
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimerRef = useRef(null);

  // Parse current value
  const parseResult = parseJson(value);
  const { parsedData, isValidJson, errorMessage } = parseResult;

  // Notify parent on value change
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const updateValue = useCallback((newValue) => {
    setValue(newValue);
    const result = parseJson(newValue);
    if (onChangeRef.current) {
      onChangeRef.current(newValue, result.isValidJson);
    }
  }, []);

  // ─── Mode Switch ──────────────────────────────────────────────
  const handleSetMode = useCallback((targetMode) => {
    if (targetMode === 'tree' && !isValidJson) {
      showToast('Cannot switch to Tree View: Invalid JSON payload');
      return;
    }
    setMode(targetMode);
  }, [isValidJson]);

  // ─── Actions ──────────────────────────────────────────────────
  const handleFormat = useCallback(() => {
    if (!isValidJson || parsedData === null) return;
    updateValue(JSON.stringify(parsedData, null, 2));
  }, [isValidJson, parsedData, updateValue]);

  const handleMinify = useCallback(() => {
    if (!isValidJson || parsedData === null) return;
    updateValue(JSON.stringify(parsedData));
  }, [isValidJson, parsedData, updateValue]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      showToast('Copied payload to clipboard!');
    } catch (err) {
      console.error('Failed to copy', err);
    }
  }, [value]);

  // ─── Toast ────────────────────────────────────────────────────
  function showToast(msg) {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ─── Code Input Change ────────────────────────────────────────
  const handleCodeChange = useCallback((e) => {
    updateValue(e.target.value);
  }, [updateValue]);

  // ─── Tree Data Change ─────────────────────────────────────────
  const handleTreeChange = useCallback((newData) => {
    const newValue = JSON.stringify(newData, null, 2);
    updateValue(newValue);
  }, [updateValue]);

  // ─── Status Indicator ─────────────────────────────────────────
  let statusDotClass = 'json-status-dot valid';
  let statusText = 'Valid JSON';
  if (!value.trim()) {
    statusDotClass = 'json-status-dot empty';
    statusText = 'Empty Payload';
  } else if (!isValidJson) {
    statusDotClass = 'json-status-dot invalid';
    statusText = 'Invalid JSON';
  }

  return (
    <div className="json-editor-wrapper">
      {/* Toolbar Header */}
      <div className="json-editor-toolbar">
        <div className="json-editor-modes">
          <button
            className={`json-btn json-btn-tab ${mode === 'code' ? 'active' : ''}`}
            onClick={() => handleSetMode('code')}
          >
            Code Editor
          </button>
          <button
            className={`json-btn json-btn-tab ${mode === 'tree' ? 'active' : ''}`}
            onClick={() => handleSetMode('tree')}
          >
            Tree View
          </button>
        </div>

        <div className="json-editor-actions">
          <button
            className="json-btn json-btn-action"
            onClick={handleFormat}
            disabled={readOnly}
            title="Prettify / Format JSON"
          >
            ✨ Format
          </button>
          <button
            className="json-btn json-btn-action"
            onClick={handleMinify}
            disabled={readOnly}
            title="Minify JSON"
          >
            ⚡ Minify
          </button>
          <button
            className="json-btn json-btn-action"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            📋 Copy
          </button>
        </div>

        <div className="json-status-indicator">
          <span className={statusDotClass}></span> {statusText}
        </div>
      </div>

      {/* Error Banner / Toast */}
      {toastMessage ? (
        <div className="json-error-banner toast">{toastMessage}</div>
      ) : (!isValidJson && value.trim()) ? (
        <div className="json-error-banner">Syntax Error: {errorMessage}</div>
      ) : null}

      {/* Main Workspace */}
      <div className="json-editor-body">
        {mode === 'code' ? (
          <div className="json-view-code">
            <textarea
              className="json-code-input"
              spellCheck="false"
              placeholder="Enter payload JSON..."
              value={value}
              onChange={handleCodeChange}
              readOnly={readOnly}
            />
          </div>
        ) : (
          <div className="json-view-tree">
            {parsedData !== null && typeof parsedData === 'object' ? (
              <TreeNode
                nodeKey={null}
                value={parsedData}
                isRoot={true}
                readOnly={readOnly}
                onUpdate={handleTreeChange}
              />
            ) : (
              <div className="json-tree-primitive">
                <span className="json-tree-label">Primitive Root:</span>
                <PrimitiveInput
                  value={parsedData}
                  readOnly={readOnly}
                  onChange={(val) => handleTreeChange(val)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Tree View Sub-Components
// ═════════════════════════════════════════════════════════════════

/**
 * TreeNode — Recursive component for rendering JSON objects/arrays
 */
function TreeNode({ nodeKey, value, isRoot, readOnly, onUpdate, onDelete }) {
  const [collapsed, setCollapsed] = useState(false);

  const valueType = getType(value);

  if (valueType !== 'object' && valueType !== 'array') {
    // Leaf node
    return (
      <TreeLeaf
        nodeKey={nodeKey}
        value={value}
        readOnly={readOnly}
        onValueChange={(newVal) => onUpdate(newVal)}
        onKeyChange={(newKey) => {
          // Key change is handled by parent
        }}
        onDelete={onDelete}
      />
    );
  }

  const isArray = valueType === 'array';
  const entries = isArray
    ? value.map((v, i) => [i, v])
    : Object.entries(value);
  const count = entries.length;

  // ─── Child Updates ──────────────────────────────────────────
  const handleChildUpdate = (childKey, newChildValue) => {
    let newValue;
    if (isArray) {
      newValue = [...value];
      newValue[childKey] = newChildValue;
    } else {
      newValue = { ...value, [childKey]: newChildValue };
    }
    onUpdate(newValue);
  };

  const handleChildDelete = (childKey) => {
    let newValue;
    if (isArray) {
      newValue = value.filter((_, i) => i !== childKey);
    } else {
      newValue = { ...value };
      delete newValue[childKey];
    }
    onUpdate(newValue);
  };

  const handleChildKeyChange = (oldKey, newKey) => {
    if (isArray || oldKey === newKey) return;
    const newValue = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === oldKey) {
        newValue[newKey] = v;
      } else {
        newValue[k] = v;
      }
    }
    onUpdate(newValue);
  };

  const handleAdd = () => {
    let newValue;
    if (isArray) {
      newValue = [...value, 'new_item'];
    } else {
      newValue = { ...value };
      let newKey = 'newKey';
      let c = 1;
      while (Object.prototype.hasOwnProperty.call(newValue, newKey)) {
        newKey = `newKey_${c++}`;
      }
      newValue[newKey] = 'value';
    }
    onUpdate(newValue);
  };

  return (
    <div className={`json-tree-node ${isRoot ? 'root' : ''}`}>
      <div className="json-tree-header">
        <span
          className="json-tree-toggle"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '▶' : '▼'}
        </span>
        {!isRoot && nodeKey !== null && (
          <>
            <span className="json-tree-key">{escapeHtml(String(nodeKey))}</span>
            <span className="json-colon">:</span>
          </>
        )}
        <span className="json-tree-type">
          {isArray ? `Array[${count}]` : `Object{${count}}`}
        </span>
        {!readOnly && !isRoot && onDelete && (
          <button
            className="json-btn-delete"
            title="Delete key"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            ×
          </button>
        )}
        {!readOnly && (
          <button
            className="json-btn-add"
            title="Add item"
            onClick={(e) => { e.stopPropagation(); handleAdd(); }}
          >
            + Add
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="json-tree-children">
          {entries.map(([key, childValue]) => {
            const childType = getType(childValue);
            if (childType === 'object' || childType === 'array') {
              return (
                <TreeNode
                  key={isArray ? key : String(key)}
                  nodeKey={key}
                  value={childValue}
                  isRoot={false}
                  readOnly={readOnly}
                  onUpdate={(newChild) => handleChildUpdate(key, newChild)}
                  onDelete={() => handleChildDelete(key)}
                />
              );
            }
            return (
              <TreeLeaf
                key={isArray ? key : String(key)}
                nodeKey={key}
                value={childValue}
                readOnly={readOnly}
                onValueChange={(newVal) => handleChildUpdate(key, newVal)}
                onKeyChange={(newKey) => handleChildKeyChange(key, newKey)}
                onDelete={() => handleChildDelete(key)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * TreeLeaf — Renders a single key-value pair (primitive value)
 */
function TreeLeaf({ nodeKey, value, readOnly, onValueChange, onKeyChange, onDelete }) {
  return (
    <div className="json-tree-leaf">
      {nodeKey !== null && (
        <>
          <span className="json-tree-key">
            {!readOnly ? (
              <input
                type="text"
                className="json-key-input"
                defaultValue={String(nodeKey)}
                onBlur={(e) => {
                  const newKey = e.target.value.trim();
                  if (newKey && newKey !== String(nodeKey) && onKeyChange) {
                    onKeyChange(newKey);
                  }
                }}
              />
            ) : (
              String(nodeKey)
            )}
          </span>
          <span className="json-colon">:</span>
        </>
      )}
      <div className="json-val-container">
        <PrimitiveInput
          value={value}
          readOnly={readOnly}
          onChange={onValueChange}
        />
      </div>
      {!readOnly && onDelete && (
        <button
          className="json-btn-delete"
          title="Delete item"
          onClick={onDelete}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * PrimitiveInput — Input for primitive values (string, number, boolean, null)
 */
function PrimitiveInput({ value, readOnly, onChange }) {
  const type = getType(value);

  if (type === 'boolean') {
    return (
      <div className="json-primitive-wrapper">
        <select
          className="json-val-select type-boolean"
          defaultValue={String(value)}
          disabled={readOnly}
          onChange={(e) => {
            if (onChange) onChange(e.target.value === 'true');
          }}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </div>
    );
  }

  if (type === 'null') {
    return (
      <div className="json-primitive-wrapper">
        <input
          className="json-val-input type-null"
          value="null"
          disabled
        />
      </div>
    );
  }

  return (
    <div className="json-primitive-wrapper">
      <input
        className={`json-val-input type-${type}`}
        defaultValue={value !== undefined ? String(value) : ''}
        readOnly={readOnly}
        onBlur={(e) => {
          if (!onChange) return;
          const valStr = e.target.value.trim();
          if (valStr === 'null') {
            onChange(null);
          } else if (!isNaN(valStr) && valStr !== '') {
            onChange(Number(valStr));
          } else {
            onChange(valStr);
          }
        }}
      />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Utility Functions
// ═════════════════════════════════════════════════════════════════

function parseJson(str) {
  if (!str || !str.trim()) {
    return { parsedData: null, isValidJson: true, errorMessage: '' };
  }
  try {
    const data = JSON.parse(str);
    return { parsedData: data, isValidJson: true, errorMessage: '' };
  } catch (err) {
    return { parsedData: null, isValidJson: false, errorMessage: err.message };
  }
}

function getType(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
