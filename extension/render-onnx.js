// octoview ONNX renderer: a Netron-style graph of the model, drawn as SVG from
// a hand-rolled protobuf wire reader (~100 lines — the alternative, protobufjs
// + a generated descriptor, is megabytes for the six message types needed).
// parseOnnx and layoutGraph are pure (no DOM) so vitest covers them.

// ---- protobuf wire reader (varint + length-delimited are all ONNX uses for
// the graph fields; fixed32/64 appear only inside tensors we skip) ----
function reader(bytes) {
  let p = 0;
  const varint = () => {
    let v = 0n;
    let shift = 0n;
    for (;;) {
      const b = bytes[p++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
      shift += 7n;
    }
  };
  return {
    get done() {
      return p >= bytes.length;
    },
    tag() {
      const t = Number(varint());
      return [t >>> 3, t & 7];
    },
    varint,
    bytes() {
      const len = Number(varint());
      const out = bytes.subarray(p, p + len);
      p += len;
      return out;
    },
    skip(wire) {
      if (wire === 0) varint();
      else if (wire === 2) this.bytes();
      else if (wire === 5) p += 4;
      else if (wire === 1) p += 8;
      else throw new Error('unsupported protobuf wire type ' + wire);
    },
  };
}

const utf8 = new TextDecoder();
const str = (b) => utf8.decode(b);

// repeated int64 that may arrive packed (one length-delimited blob) or not
function int64s(field, wire, r, out) {
  if (wire === 2) {
    const rr = reader(r.bytes());
    while (!rr.done) out.push(Number(rr.varint()));
  } else out.push(Number(r.varint()));
}

const DTYPE = {
  1: 'f32',
  2: 'u8',
  3: 'i8',
  4: 'u16',
  5: 'i16',
  6: 'i32',
  7: 'i64',
  9: 'bool',
  10: 'f16',
  11: 'f64',
  12: 'u32',
  13: 'u64',
  16: 'bf16',
};

function parseNode(bytes) {
  const r = reader(bytes);
  const node = { inputs: [], outputs: [], name: '', op: '' };
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1) node.inputs.push(str(r.bytes()));
    else if (f === 2) node.outputs.push(str(r.bytes()));
    else if (f === 3) node.name = str(r.bytes());
    else if (f === 4) node.op = str(r.bytes());
    else r.skip(w);
  }
  return node;
}

function parseTensorInfo(bytes) {
  const r = reader(bytes);
  const t = { dims: [], dtype: '?', name: '' };
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1) int64s(f, w, r, t.dims);
    else if (f === 2) t.dtype = DTYPE[Number(r.varint())] || '?';
    else if (f === 8) t.name = str(r.bytes());
    else r.skip(w);
  }
  return t;
}

function parseValueInfoName(bytes) {
  const r = reader(bytes);
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1) return str(r.bytes());
    r.skip(w);
  }
  return '';
}

// ModelProto.graph = 7; GraphProto: node=1, name=2, initializer=5, input=11, output=12.
export function parseOnnx(buf) {
  const r = reader(new Uint8Array(buf));
  let graphBytes = null;
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 7 && w === 2) graphBytes = r.bytes();
    else r.skip(w);
  }
  if (!graphBytes) throw new Error('no graph found (not an ONNX model?)');
  const g = reader(graphBytes);
  const graph = { name: '', nodes: [], initializers: [], inputs: [], outputs: [] };
  while (!g.done) {
    const [f, w] = g.tag();
    if (f === 1) graph.nodes.push(parseNode(g.bytes()));
    else if (f === 2) graph.name = str(g.bytes());
    else if (f === 5) graph.initializers.push(parseTensorInfo(g.bytes()));
    else if (f === 11) graph.inputs.push(parseValueInfoName(g.bytes()));
    else if (f === 12) graph.outputs.push(parseValueInfoName(g.bytes()));
    else g.skip(w);
  }
  if (!graph.nodes.length) throw new Error('ONNX graph has no nodes');
  return graph;
}

// Layered layout: rank = longest path from any graph input, nodes in a rank
// ordered by the mean order of their predecessors (one barycenter pass).
// ponytail: no crossing minimization beyond that — escalate to @dagrejs/dagre
// if inception-style graphs ever look tangled.
export function layoutGraph(graph) {
  const weightNames = new Set(graph.initializers.map((t) => t.name));
  const producer = new Map();
  graph.nodes.forEach((n, i) => n.outputs.forEach((o) => producer.set(o, i)));

  const rank = new Array(graph.nodes.length).fill(0);
  const order = graph.nodes.map((_, i) => i);
  // nodes are topologically sorted in valid ONNX files; one forward pass ranks
  graph.nodes.forEach((n, i) => {
    for (const input of n.inputs) {
      const p = producer.get(input);
      if (p !== undefined) rank[i] = Math.max(rank[i], rank[p] + 1);
    }
  });
  const layers = [];
  order.forEach((i) => {
    (layers[rank[i]] ??= []).push(i);
  });
  const posInLayer = new Map();
  layers.forEach((layer) => {
    layer.sort((a, b) => {
      const bary = (i) => {
        const ps = graph.nodes[i].inputs.map((x) => producer.get(x)).filter((x) => x !== undefined);
        return ps.length ? ps.reduce((s, x) => s + (posInLayer.get(x) ?? 0), 0) / ps.length : 0;
      };
      return bary(a) - bary(b);
    });
    layer.forEach((i, k) => posInLayer.set(i, k));
  });

  const W = 168;
  const H = 46;
  const GX = 36;
  const GY = 46;
  const nodes = graph.nodes.map((n, i) => {
    const layer = layers[rank[i]];
    const k = layer.indexOf(i);
    const layerWidth = layer.length * (W + GX) - GX;
    const weights = n.inputs.filter((x) => weightNames.has(x));
    return {
      ...n,
      i,
      x: k * (W + GX) - layerWidth / 2,
      y: rank[i] * (H + GY),
      w: W,
      h: H,
      weights,
    };
  });
  const byIndex = new Map(nodes.map((n) => [n.i, n]));
  const edges = [];
  graph.nodes.forEach((n, i) => {
    for (const input of n.inputs) {
      const p = producer.get(input);
      if (p !== undefined) edges.push({ from: byIndex.get(p), to: byIndex.get(i), name: input });
    }
  });
  return { nodes, edges };
}

const XMLNS = 'http://www.w3.org/2000/svg';
const OP_COLORS = {
  Conv: '#1f6feb',
  MatMul: '#1f6feb',
  Gemm: '#1f6feb',
  Relu: '#238636',
  Sigmoid: '#238636',
  Tanh: '#238636',
  Softmax: '#8957e5',
};

export function renderOnnx(buf, mount) {
  mount.textContent = '';
  try {
    const graph = parseOnnx(buf);
    const { nodes, edges } = layoutGraph(graph);
    ensureStyle();

    const meta = document.createElement('div');
    meta.className = 'ov-mdl-meta';
    const params = graph.initializers.reduce(
      (s, t) => s + t.dims.reduce((a, d) => a * d, t.dims.length ? 1 : 0),
      0
    );
    meta.textContent =
      `${graph.name || 'ONNX graph'} · ${graph.nodes.length} ops · ` +
      `${graph.initializers.length} tensors · ${params.toLocaleString()} params`;
    mount.appendChild(meta);

    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 40;
    const maxX = Math.max(...xs.map((x, i) => x + nodes[i].w)) + 40;
    const maxY = Math.max(...ys) + 46 + 30;
    const svg = document.createElementNS(XMLNS, 'svg');
    svg.setAttribute('viewBox', `${minX} -20 ${maxX - minX} ${maxY + 20}`);
    svg.setAttribute('class', 'ov-onnx-svg');
    svg.style.maxHeight = '74vh';

    for (const e of edges) {
      const path = document.createElementNS(XMLNS, 'path');
      const x1 = e.from.x + e.from.w / 2;
      const y1 = e.from.y + e.from.h;
      const x2 = e.to.x + e.to.w / 2;
      const y2 = e.to.y;
      path.setAttribute(
        'd',
        `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`
      );
      path.setAttribute('class', 'ov-onnx-edge');
      svg.appendChild(path);
    }
    for (const n of nodes) {
      const group = document.createElementNS(XMLNS, 'g');
      const rect = document.createElementNS(XMLNS, 'rect');
      rect.setAttribute('x', n.x);
      rect.setAttribute('y', n.y);
      rect.setAttribute('width', n.w);
      rect.setAttribute('height', n.h);
      rect.setAttribute('rx', 7);
      rect.setAttribute('class', 'ov-onnx-node');
      rect.setAttribute('style', `stroke:${OP_COLORS[n.op] || '#30363d'}`);
      const op = document.createElementNS(XMLNS, 'text');
      op.setAttribute('x', n.x + n.w / 2);
      op.setAttribute('y', n.y + 19);
      op.setAttribute('class', 'ov-onnx-op');
      op.textContent = n.op;
      const label = document.createElementNS(XMLNS, 'text');
      label.setAttribute('x', n.x + n.w / 2);
      label.setAttribute('y', n.y + 36);
      label.setAttribute('class', 'ov-onnx-name');
      label.textContent = n.name || n.outputs[0] || '';
      group.append(rect, op, label);
      const title = document.createElementNS(XMLNS, 'title');
      title.textContent =
        `${n.op}\nin: ${n.inputs.join(', ')}\nout: ${n.outputs.join(', ')}` +
        (n.weights.length ? `\nweights: ${n.weights.join(', ')}` : '');
      group.appendChild(title);
      svg.appendChild(group);
    }
    mount.appendChild(svg);

    // weights table, same look as the safetensors/gguf listing
    if (graph.initializers.length) {
      const h = document.createElement('div');
      h.className = 'ov-mdl-h';
      h.textContent = 'Initializers';
      mount.appendChild(h);
      const scroll = document.createElement('div');
      scroll.className = 'ov-tbl-scroll';
      const table = document.createElement('table');
      table.className = 'ov-tbl';
      const head = table.createTHead().insertRow();
      for (const c of ['tensor', 'dtype', 'shape']) head.insertCell().textContent = c;
      const body = table.createTBody();
      for (const t of graph.initializers) {
        const tr = body.insertRow();
        tr.insertCell().textContent = t.name;
        tr.insertCell().textContent = t.dtype;
        tr.insertCell().textContent = t.dims.join(' × ') || 'scalar';
      }
      scroll.appendChild(table);
      mount.appendChild(scroll);
    }
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'ov-msg';
    p.textContent = 'ONNX preview failed: ' + ((e && e.message) || e);
    mount.appendChild(p);
  }
}

function ensureStyle() {
  if (document.getElementById('ov-onnx-style')) return;
  const s = document.createElement('style');
  s.id = 'ov-onnx-style';
  s.textContent = `
    .ov-onnx-svg{display:block;width:100%;margin:8px 0}
    .ov-onnx-node{fill:#161b22;stroke-width:1.4}
    .ov-onnx-edge{fill:none;stroke:#3d444d;stroke-width:1.4}
    .ov-onnx-op{fill:#e6edf3;font:600 13px -apple-system,BlinkMacSystemFont,sans-serif;text-anchor:middle}
    .ov-onnx-name{fill:#8d96a0;font:10.5px ui-monospace,monospace;text-anchor:middle}`;
  document.head.appendChild(s);
}
