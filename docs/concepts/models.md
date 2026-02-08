# Model Selection

This server exclusively uses **Gemini 3 Pro**.

## Supported Model

### gemini-3-pro-preview
- **Best for**: Complex analysis, large codebases, architectural reviews
- **Context**: 2M tokens
- **Use when**: All tasks — this is the only supported model

## Setting Models

The default model is `gemini-3-pro-preview`. You can override via environment variable, but only `gemini-3-pro-preview` is accepted:

### In Configuration
```json
{
  "mcpServers": {
    "gemini-cli": {
      "command": "gemini-mcp",
      "env": {
        "GEMINI_DEFAULT_MODEL": "gemini-3-pro-preview"
      }
    }
  }
}
```

## Token Limits

- **Pro**: ~2 million tokens (~500k lines of code)

## Recommendations

- **Code Review**: Pro
- **Architecture Analysis**: Pro
- **Quick Fixes**: Pro
- **Documentation**: Pro
- **Security Audit**: Pro
- **Brainstorming**: Pro
