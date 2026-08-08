#!/usr/bin/env python3
"""Extract each Research Hub page's LAYOUT TREE from the Qt app.

`qt-extract.py` produced an inventory — which buttons, which fields — and the
web hub then invented its own arrangement for them. That is why the pages did
not look like the app: the inventory was right and the layout was mine.

The layout is not hidden. `app_qt.py` builds it with literal calls:

    layout = QtWidgets.QVBoxLayout(self)     # the page's root
    sel    = QtWidgets.QHBoxLayout()         # a row
    sel.addWidget(self._file_edit, 1)        # with a stretch factor
    sel.addWidget(browse)
    layout.addLayout(sel)
    tabs.addTab(file_tab, "File QA")         # a tab holding file_tab's layout

Walking those in source order recovers the tree exactly, and it maps onto CSS
almost one to one: QVBoxLayout is a flex column, QHBoxLayout a flex row, a
stretch factor is `flex`, addStretch is a spacer, QGridLayout is a grid with
explicit rows and columns.

    python3 GeoID_GIS/services/qt-layout.py           # write the tree
    python3 GeoID_GIS/services/qt-layout.py --show "QA / QC"

Output: GeoID_GIS/viewer/gis/research/qt-layout.json
"""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path

QT_APP = Path("/home/owen/atlas-ai/apps/GeoID_Research/app_qt.py")
OUT = Path(__file__).resolve().parents[1] / "viewer/gis/research/qt-layout.json"

LAYOUT_KINDS = {"QVBoxLayout", "QHBoxLayout", "QGridLayout", "QFormLayout", "QStackedLayout"}
CONTAINER_KINDS = {"QWidget", "QFrame", "QGroupBox", "QScrollArea", "CollapsibleSection"}

# Widgets worth rendering. Anything else is skipped rather than guessed at.
WIDGET_KINDS = {
    "QLabel", "QLineEdit", "QPlainTextEdit", "QTextEdit", "QPushButton",
    "QToolButton", "QComboBox", "QCheckBox", "QRadioButton", "QSpinBox",
    "QDoubleSpinBox", "QSlider", "QListWidget", "QTableWidget", "QTreeWidget",
    "QTabWidget", "QProgressBar", "QDateEdit", "QDateTimeEdit", "QSplitter",
    "QGroupBox", "QFrame", "QWidget", "PageHeader", "CollapsibleSection",
}


def name_of(node):
    """The callee name of a Call, or '' — `QtWidgets.QLabel` -> 'QLabel'."""
    fn = node.func
    if isinstance(fn, ast.Attribute):
        return fn.attr
    if isinstance(fn, ast.Name):
        return fn.id
    return ""


def var_of(node):
    """The variable a node refers to: `self._x` -> '_x', `x` -> 'x'."""
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Name):
        return node.id
    return None


def const(node):
    if isinstance(node, ast.Constant):
        return node.value
    return None


def const_list(node):
    if isinstance(node, (ast.List, ast.Tuple)):
        out = [const(e) for e in node.elts]
        return [v for v in out if v is not None]
    return []


class PageReader(ast.NodeVisitor):
    """Reads one page class into widgets, layouts and an ordered add-list."""

    def __init__(self):
        self.widgets = {}     # var -> {kind, text, props}
        self.layouts = {}     # var -> {kind, owner}
        self.adds = []        # (line, owner_layout, op, payload)
        self.tabs = []        # (line, tabwidget_var, child_widget_var, label)
        self.counter = 0

    # `x = QtWidgets.Something(...)`
    def visit_Assign(self, node):
        if isinstance(node.value, ast.Call):
            kind = name_of(node.value)
            for target in node.targets:
                var = var_of(target)
                if not var:
                    continue
                if kind in LAYOUT_KINDS:
                    owner = var_of(node.value.args[0]) if node.value.args else None
                    self.layouts[var] = {"kind": kind, "owner": owner, "line": node.lineno}
                elif kind in WIDGET_KINDS or kind in CONTAINER_KINDS:
                    args = [const(a) for a in node.value.args]
                    props = {}
                    for kw in node.value.keywords:
                        if kw.arg == "collapsed":
                            props["collapsed"] = bool(const(kw.value))
                    self.widgets[var] = {
                        "kind": kind,
                        "text": next((a for a in args if isinstance(a, str)), None),
                        "args": [a for a in args if a is not None],
                        "props": props,
                        "line": node.lineno,
                    }
        self.generic_visit(node)

    def visit_For(self, node):
        """Apply a property set on a loop variable to each widget looped over.

        `for w in (self.clip_min_x, self.clip_max_x): w.setFixedWidth(88)` is a
        common Qt shorthand, and the receiver `w` is not a widget -- so the
        width was being dropped for every field written that way.
        """
        targets = [var_of(e) for e in node.iter.elts] if isinstance(node.iter, (ast.Tuple, ast.List)) else []
        loop_var = var_of(node.target)
        targets = [t for t in targets if t in self.widgets]
        if loop_var and targets:
            # Read the body once against a scratch widget, then copy what it set
            # onto each real one.
            scratch = {"kind": "QWidget", "text": None, "args": [], "props": {}, "line": node.lineno}
            self.widgets[loop_var] = scratch
            for stmt in node.body:
                self.generic_visit(stmt)
            self.widgets.pop(loop_var, None)
            for name in targets:
                self.widgets[name]["props"].update(scratch["props"])
            return
        self.generic_visit(node)

    def visit_Call(self, node):
        fn = node.func
        if isinstance(fn, ast.Attribute):
            owner = var_of(fn.value)
            op = fn.attr

            # CollapsibleSection's own API is add_widget / add_layout, and a
            # QSplitter takes addWidget directly. Both were being dropped, which
            # is why Signal Processing came out as four empty sections and
            # Projects as an empty splitter.
            if op in ("add_widget", "add_layout"):
                op = "addWidget" if op == "add_widget" else "addLayout"
            if op in ("addWidget", "addLayout") and node.args:
                child = var_of(node.args[0])
                # An inline widget: addWidget(QtWidgets.QLabel("x"))
                inline = None
                if child is None and isinstance(node.args[0], ast.Call):
                    kind = name_of(node.args[0])
                    if kind in WIDGET_KINDS:
                        self.counter += 1
                        child = f"__inline{self.counter}"
                        args = [const(a) for a in node.args[0].args]
                        inline = {
                            "kind": kind,
                            "text": next((a for a in args if isinstance(a, str)), None),
                            "args": [a for a in args if a is not None],
                            "props": {}, "line": node.lineno,
                        }
                        self.widgets[child] = inline
                if child:
                    extra = [const(a) for a in node.args[1:]]
                    nums = [a for a in extra if isinstance(a, int)]
                    payload = {"child": child, "kind": op}
                    for arg in node.args[1:]:
                        name = arg.attr if isinstance(arg, ast.Attribute) else ""
                        if name.startswith("Align"):
                            payload["align"] = name[5:].lower()
                    # QGridLayout: addWidget(w, row, col[, rowspan, colspan])
                    if len(nums) >= 2:
                        payload["row"], payload["col"] = nums[0], nums[1]
                        if len(nums) >= 4:
                            payload["rowspan"], payload["colspan"] = nums[2], nums[3]
                    elif len(nums) == 1:
                        payload["stretch"] = nums[0]
                    self.adds.append((node.lineno, owner, op, payload))

            elif op == "addStretch":
                self.adds.append((node.lineno, owner, "addStretch", {}))

            elif op == "addSpacing" and node.args:
                self.adds.append((node.lineno, owner, "addSpacing",
                                  {"px": const(node.args[0]) or 8}))

            elif op == "addRow" and len(node.args) >= 2:
                self.adds.append((node.lineno, owner, "addRow", {
                    "label": const(node.args[0]),
                    "child": var_of(node.args[1]),
                }))

            elif op == "setWidget" and node.args:
                child = var_of(node.args[0])
                if child:
                    self.adds.append((node.lineno, owner, "addWidget",
                                      {"child": child, "kind": "addWidget"}))

            elif op == "addTab" and len(node.args) >= 2:
                self.tabs.append((node.lineno, owner, var_of(node.args[0]),
                                  const(node.args[1])))

            # Widget properties, recorded against the receiver.
            elif owner in self.widgets:
                props = self.widgets[owner]["props"]
                if op == "setPlaceholderText" and node.args:
                    props["placeholder"] = const(node.args[0])
                elif op == "addItems" and node.args:
                    props["items"] = const_list(node.args[0])
                elif op in ("setHorizontalHeaderLabels", "setHeaderLabels") and node.args:
                    props["headers"] = const_list(node.args[0])
                elif op == "setText" and node.args:
                    props["text"] = const(node.args[0])
                elif op == "setObjectName" and node.args:
                    props["objectName"] = const(node.args[0])
                elif op == "setReadOnly":
                    props["readOnly"] = bool(const(node.args[0])) if node.args else True
                elif op == "setChecked":
                    props["checked"] = bool(const(node.args[0])) if node.args else True
                elif op in ("setMaximumHeight", "setFixedHeight") and node.args:
                    props["maxHeight"] = const(node.args[0])
                elif op == "setWordWrap":
                    props["wrap"] = True
                elif op == "setToolTip" and node.args:
                    props["tip"] = const(node.args[0])
                elif op in ("setFixedWidth", "setMaximumWidth") and node.args:
                    props["width"] = const(node.args[0])
                elif op == "setMinimumWidth" and node.args:
                    props["minWidth"] = const(node.args[0])
                elif op in ("setMinimumHeight",) and node.args:
                    props["minHeight"] = const(node.args[0])
                elif op == "setRange" and len(node.args) >= 2:
                    props["range"] = [const(node.args[0]), const(node.args[1])]
                elif op == "setValue" and node.args:
                    props["value"] = const(node.args[0])
                elif op == "setCurrentText" and node.args:
                    props["value"] = const(node.args[0])
        self.generic_visit(node)


def build_tree(reader, root_layout):
    """Turn the flat add-list into nested nodes."""
    by_layout = {}
    for line, owner, op, payload in sorted(reader.adds):
        by_layout.setdefault(owner, []).append((line, op, payload))

    # widget var -> the layout it owns, so a container recurses into its content
    owned = {}
    for var, info in reader.layouts.items():
        if info["owner"]:
            owned.setdefault(info["owner"], var)

    tabs_by_widget = {}
    for line, tabwidget, child, label in sorted(reader.tabs):
        tabs_by_widget.setdefault(tabwidget, []).append((label, child))

    seen = set()

    def render_child(var, depth=0):
        """Resolve an added child, which may be either a layout or a widget."""
        if var in reader.layouts:
            return render_layout(var, depth)
        return render_widget(var, depth)

    def render_layout(var, depth=0):
        if not var or var in seen or depth > 12:
            return None
        seen.add(var)
        info = reader.layouts.get(var, {"kind": "QVBoxLayout"})
        node = {"node": "layout", "kind": info["kind"], "children": []}
        for _line, op, payload in by_layout.get(var, []):
            if op == "addStretch":
                node["children"].append({"node": "stretch"})
            elif op == "addSpacing":
                node["children"].append({"node": "spacing", "px": payload["px"]})
            elif op == "addRow":
                child = render_child(payload["child"], depth + 1)
                node["children"].append({
                    "node": "row", "label": payload["label"], "child": child,
                })
            elif op == "addLayout":
                child = render_layout(payload["child"], depth + 1)
                if child:
                    child.update({k: v for k, v in payload.items()
                                  if k in ("stretch", "row", "col", "rowspan", "colspan", "align")})
                    node["children"].append(child)
            else:
                child = render_child(payload["child"], depth + 1)
                if child:
                    child.update({k: v for k, v in payload.items()
                                  if k in ("stretch", "row", "col", "rowspan", "colspan", "align")})
                    node["children"].append(child)
        return node

    def render_widget(var, depth=0):
        if not var or depth > 12:
            return None
        info = reader.widgets.get(var)
        if not info:
            # A container built inline, or something we do not model.
            inner = render_layout(owned.get(var), depth + 1)
            return inner
        node = {
            "node": "widget", "kind": info["kind"], "var": var,
            "text": info.get("props", {}).get("text") or info.get("text"),
            **{k: v for k, v in info.get("props", {}).items() if k != "text"},
        }
        if info["kind"] == "QTabWidget":
            node["node"] = "tabs"
            node["tabs"] = []
            for label, child in tabs_by_widget.get(var, []):
                node["tabs"].append({
                    "label": label,
                    "content": render_layout(owned.get(child), depth + 1)
                               or render_child(child, depth + 1),
                })
            return node
        # A container's real content is the layout it owns...
        inner = owned.get(var)
        if inner:
            node["content"] = render_layout(inner, depth + 1)
        # ...or, for a splitter or a CollapsibleSection, the widgets added
        # straight to it.
        elif var in by_layout:
            kids = []
            for _line, op, payload in by_layout.get(var, []):
                child = render_child(payload.get("child"), depth + 1)
                if child:
                    if "stretch" in payload:
                        child["stretch"] = payload["stretch"]
                    kids.append(child)
            if kids:
                node["content"] = {
                    "node": "layout",
                    "kind": "QHBoxLayout" if info["kind"] == "QSplitter" else "QVBoxLayout",
                    "children": kids,
                }
        return node

    return render_layout(root_layout)


def extract():
    tree = ast.parse(QT_APP.read_text(encoding="utf-8"), filename=str(QT_APP))
    spec_path = OUT.parent / "qt-spec.json"
    mapping = {}
    if spec_path.exists():
        spec = json.loads(spec_path.read_text())
        for page_id, entry in spec.items():
            mapping.setdefault(entry["qt_class"], []).append(page_id)

    pages = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef) or node.name not in mapping:
            continue
        reader = PageReader()
        for item in node.body:
            reader.visit(item)
        # The page's root layout is the one constructed with `self`.
        root = next((v for v, i in reader.layouts.items() if i["owner"] == "self"), None)
        if not root:
            continue
        built = build_tree(reader, root)
        if not built:
            continue
        for page_id in mapping[node.name]:
            pages[page_id] = {"qt_class": node.name, "root": built}
    return pages


def summarise(node, depth=0, out=None):
    out = out if out is not None else []
    pad = "  " * depth
    if node["node"] == "layout":
        out.append(f"{pad}{node['kind']}"
                   + (f"  flex={node['stretch']}" if "stretch" in node else ""))
        for c in node["children"]:
            summarise(c, depth + 1, out)
    elif node["node"] == "tabs":
        out.append(f"{pad}QTabWidget")
        for tab in node["tabs"]:
            out.append(f"{pad}  [{tab['label']}]")
            if tab["content"]:
                summarise(tab["content"], depth + 2, out)
    elif node["node"] == "widget":
        label = node.get("text") or node.get("placeholder") or node.get("var", "")
        out.append(f"{pad}{node['kind']}  {str(label)[:44]}")
        if node.get("content"):
            summarise(node["content"], depth + 1, out)
    elif node["node"] == "row":
        out.append(f"{pad}row: {node['label']}")
        if node.get("child"):
            summarise(node["child"], depth + 1, out)
    elif node["node"] == "stretch":
        out.append(f"{pad}<stretch>")
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--show", help="print one page's tree instead of writing")
    args = parser.parse_args()

    pages = extract()
    if args.show:
        page = pages.get(args.show)
        if not page:
            raise SystemExit(f"no layout for {args.show!r}; have "
                             f"{len(pages)}: {', '.join(sorted(pages)[:8])}…")
        print(f"{args.show}  ({page['qt_class']})")
        print("\n".join(summarise(page["root"])))
        return 0

    OUT.write_text(json.dumps(pages, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    nodes = sum(len(summarise(p["root"])) for p in pages.values())
    print(f"wrote {OUT.name} — {len(pages)} pages, {nodes} layout nodes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
