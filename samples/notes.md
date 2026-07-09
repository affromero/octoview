# Markdown sample

GitHub renders Markdown fine, but octoview gives you a consistent preview from a private-repo blob
without leaving the file view — and it's where LaTeX support will land.

## Features

- Headings, **bold**, _italic_, `inline code`
- Lists and tables
- Fenced code blocks

```python
def train(model, data):
    for epoch in range(3):
        model.step(data)
    return model
```

| Metric | Value |
| ------ | ----- |
| loss   | 0.032 |
| acc    | 0.991 |

> Math (KaTeX rendering is on the roadmap): the loss is $\mathcal{L} = -\sum_i y_i \log \hat{y}_i$.
