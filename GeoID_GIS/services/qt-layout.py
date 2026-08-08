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
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qt_names import rename_tree  # noqa: E402

QT_APP = Path("/home/owen/atlas-ai/apps/GeoID_Research/app_qt.py")
OUT = Path(__file__).resolve().parents[1] / "viewer/gis/research/qt-layout.json"

LAYOUT_KINDS = {"QVBoxLayout", "QHBoxLayout", "QGridLayout", "QFormLayout", "QStackedLayout"}

# The app's own widget classes -> the Qt class each extends. Filled by
# `custom_widgets()` so the renderer can treat `CodeEditor` as a QPlainTextEdit.
CUSTOM_BASE = {}
CONTAINER_KINDS = {"QWidget", "QFrame", "QGroupBox", "QScrollArea", "QStackedWidget",
                   "CollapsibleSection"}

# Widgets worth rendering. Anything else is skipped rather than guessed at.
WIDGET_KINDS = {
    "QLabel", "QLineEdit", "QPlainTextEdit", "QTextEdit", "QPushButton",
    "QToolButton", "QComboBox", "QCheckBox", "QRadioButton", "QSpinBox",
    "QDoubleSpinBox", "QSlider", "QListWidget", "QTableWidget", "QTreeWidget",
    "QTabWidget", "QProgressBar", "QDateEdit", "QDateTimeEdit", "QSplitter",
    "QGroupBox", "QFrame", "QWidget", "PageHeader", "CollapsibleSection",
    "QStackedWidget",
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

    def __init__(self, methods=None, depth=0):
        self.widgets = {}     # var -> {kind, text, props}
        self.layouts = {}     # var -> {kind, owner}
        self.adds = []        # (line, owner_layout, op, payload)
        self.tabs = []        # (line, tabwidget_var, child_widget_var, label)
        self.counter = 0
        # The class's own methods, so a factory call can be inlined.
        self.methods = methods or {}
        self.depth = depth
        # Loop variables currently bound to literals, so `QPushButton(label)`
        # inside `for label, slot in [("CSV", …), …]` reads as "CSV".
        self.consts = {}
        # Whether the statements being read are the constructor's. A property
        # set anywhere else is *runtime* state, not initial state.
        self.in_init = True
        self.locked = {}      # var -> keys __init__ already decided
        self.class_lists = {}  # class-level list constants, e.g. _MODELS

    def visit_FunctionDef(self, node):
        """Read each method, remembering whether it is the constructor.

        MapPage sets `self._embed_toggle.setChecked(True)` in `__init__` and
        `setChecked(False)` in `_ensure_view`, its fallback for when WebEngine
        is missing. Reading the class in source order let the fallback win, and
        the page rendered with Embedded switched off — a runtime branch that
        never applies in a browser deciding how the page starts.
        """
        was, self.in_init = self.in_init, node.name == "__init__"
        self.generic_visit(node)
        self.in_init = was

    def set_prop(self, var, key, value):
        """Record a widget property, letting the constructor have the last word."""
        info = self.widgets.get(var)
        if info is None:
            return
        if not self.in_init and key in self.locked.get(var, ()):
            return
        info["props"][key] = value
        if self.in_init:
            self.locked.setdefault(var, set()).add(key)

    def literal(self, node):
        """A constant, resolving a name the enclosing loop bound to one."""
        value = const(node)
        if value is not None:
            return value
        name = var_of(node)
        return self.consts.get(name) if name else None

    def absorb(self, inner, tag, bound=None, offset=0.0):
        """Merge a sub-reader's widgets, layouts and adds under a prefix.

        Shared by the factory-method inlining and the loop expansion: both read
        a body with its own reader and then need it to look as though it had
        been written inline here.

        `offset` nudges the line numbers: every pass of an expanded loop reads
        the *same* source lines, so without it the passes tie and their order
        is whatever sort happens to give.
        """
        bound = bound or {}

        def rename(var):
            if var is None or var == "self":
                return var
            if var in bound:
                return bound[var]
            if var in inner.widgets or var in inner.layouts:
                return tag + var
            return var

        for var, info in inner.widgets.items():
            self.widgets.setdefault(tag + var, info)
        for var, info in inner.layouts.items():
            info = dict(info)
            info["owner"] = rename(info["owner"])
            self.layouts.setdefault(tag + var, info)
        for line, owner, op, payload in inner.adds:
            payload = dict(payload)
            if "child" in payload:
                payload["child"] = rename(payload["child"])
            self.adds.append((line + offset, rename(owner), op, payload))
        for line, tabwidget, child, text in inner.tabs:
            self.tabs.append((line + offset, rename(tabwidget), rename(child), text))
        return rename

    def inline_method(self, name, call, targets):
        """Inline `self._series_box("…")` at its call site.

        A page builds part of itself in a helper that *returns* a widget or a
        layout — `_series_box` (app_qt.py:10750) returns a QGroupBox holding a
        three-row form, and `_browse_row` returns a QHBoxLayout of a field and
        its Browse button. The call site is the only thing `__init__` shows, so
        the whole box was invisible to the tree.

        The method body is read with its own reader, its variables are renamed
        so they cannot collide with the caller's, its parameters are bound to
        whatever the caller passed, and what it returns is bound to whatever the
        caller assigned. After that it is indistinguishable from code written
        inline, which is what it is.
        """
        method = self.methods.get(name)
        if method is None or self.depth > 3:
            return False
        inner = PageReader(self.methods, self.depth + 1)
        for stmt in method.body:
            inner.visit(stmt)

        self.counter += 1
        tag = f"_m{self.counter}_"

        # Parameters take the caller's arguments, so a widget passed in stays
        # the caller's widget rather than becoming a fresh unknown.
        bound = {}
        params = [a.arg for a in method.args.args[1:]]
        for param, arg in zip(params, call.args):
            supplied = var_of(arg)
            if supplied:
                bound[param] = supplied
        # Keywords too: `self._browse_row(self.thesis_peaks_root, file_mode=False)`
        # is how most of these are actually called.
        for kw in call.keywords:
            supplied = var_of(kw.value) if kw.arg else None
            if kw.arg and supplied:
                bound[kw.arg] = supplied

        def rename(var):
            if var is None or var == "self":
                return var
            if var in bound:
                return bound[var]
            if var in inner.widgets or var in inner.layouts:
                return tag + var
            return var

        for var, info in inner.widgets.items():
            self.widgets.setdefault(tag + var, info)
        for var, info in inner.layouts.items():
            info = dict(info)
            info["owner"] = rename(info["owner"])
            self.layouts.setdefault(tag + var, info)
        for line, owner, op, payload in inner.adds:
            payload = dict(payload)
            if "child" in payload:
                payload["child"] = rename(payload["child"])
            self.adds.append((line, rename(owner), op, payload))
        for line, tabwidget, child, text in inner.tabs:
            self.tabs.append((line, rename(tabwidget), rename(child), text))

        # What the method returns, bound to what the caller assigned.
        returned = next((st.value for st in ast.walk(method)
                         if isinstance(st, ast.Return) and st.value is not None), None)
        if returned is None:
            return True
        names = ([var_of(e) for e in returned.elts]
                 if isinstance(returned, (ast.Tuple, ast.List)) else [var_of(returned)])
        for target, source in zip(targets, names):
            if not target or not source:
                continue
            renamed = rename(source)
            if renamed in self.widgets:
                self.widgets[target] = self.widgets[renamed]
            elif renamed in self.layouts:
                self.layouts[target] = self.layouts[renamed]
            # Anything already added under the inner name must follow the alias.
            for index, (line, owner, op, payload) in enumerate(self.adds):
                if owner == renamed:
                    self.adds[index] = (line, target, op, payload)
                elif payload.get("child") == renamed:
                    fixed = dict(payload)
                    fixed["child"] = target
                    self.adds[index] = (line, owner, op, fixed)
            if renamed in self.layouts:
                self.layouts[target] = self.layouts.pop(renamed)
            for var, info in self.layouts.items():
                if info.get("owner") == renamed:
                    info["owner"] = target
        return True

    # `x = QtWidgets.Something(...)`
    def visit_Assign(self, node):
        # `path, t_col, y_col, group = self._series_box("…")`
        if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute) \
                and var_of(node.value.func.value) == "self" \
                and node.value.func.attr in self.methods:
            targets = []
            for target in node.targets:
                if isinstance(target, (ast.Tuple, ast.List)):
                    targets = [var_of(e) for e in target.elts]
                else:
                    targets = [var_of(target)]
            if self.inline_method(node.value.func.attr, node.value, targets):
                return
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
                    args = [self.literal(a) for a in node.value.args]
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
        """Expand a loop over a literal list of widgets.

        Two Qt shorthands hide behind one construct, and both were losing whole
        blocks of a page:

            for w in (self.clip_min_x, self.clip_max_x): w.setFixedWidth(88)
            for w in [save_btn, stamp_btn, h1_btn, ...]: toolbar.addWidget(w)

        The receiver is the loop variable, which is not a widget, so the
        property landed nowhere and the add referred to nothing. Research Notes'
        entire Markdown toolbar -- ten buttons -- is written the second way.
        """
        if not isinstance(node.iter, (ast.Tuple, ast.List)):
            self.generic_visit(node)
            return

        # A loop over literal *data* that builds a widget per item:
        #
        #     for label, slot in [("CSV", self._add_layer_csv),
        #                         ("GeoJSON", self._add_layer_geojson), …]:
        #         b = QtWidgets.QPushButton(label)
        #         add_row.addWidget(b)
        #
        # Map's five add-layer buttons are written this way, and the tree saw
        # one nameless button. Each pass gets the item bound to the loop
        # variable, so the constructor reads the label it was given.
        targets = ([var_of(e) for e in node.target.elts]
                   if isinstance(node.target, (ast.Tuple, ast.List))
                   else [var_of(node.target)])
        items = []
        for element in node.iter.elts:
            parts = (element.elts if isinstance(element, (ast.Tuple, ast.List))
                     else [element])
            values = [const(p) for p in parts]
            if any(v is not None for v in values):
                items.append(values)
            else:
                items = []
                break
        if items and len(items) == len(node.iter.elts) and any(targets):
            for index, values in enumerate(items):
                inner = PageReader(self.methods, self.depth + 1)
                inner.consts = dict(self.consts)
                for name, value in zip(targets, values):
                    if name and value is not None:
                        inner.consts[name] = value
                for stmt in node.body:
                    inner.visit(stmt)
                self.counter += 1
                self.absorb(inner, f"_i{self.counter}_", offset=index / 1000.0)
            return

        loop_var = var_of(node.target)
        if not loop_var:
            self.generic_visit(node)
            return

        # Each element, registering any built inline so it can be rendered.
        members = []
        for element in node.iter.elts:
            name = var_of(element)
            if name is None and isinstance(element, ast.Call):
                kind = name_of(element)
                if kind in WIDGET_KINDS or kind in CONTAINER_KINDS:
                    self.counter += 1
                    name = f"__loop{self.counter}"
                    args = [const(a) for a in element.args]
                    self.widgets[name] = {
                        "kind": kind,
                        "text": next((a for a in args if isinstance(a, str)), None),
                        "args": [a for a in args if a is not None],
                        "props": {}, "line": node.lineno,
                    }
            if name:
                members.append(name)
        if not members:
            self.generic_visit(node)
            return

        # Read the body once against a scratch stand-in for the loop variable,
        # then replay what it did onto each member in order.
        scratch = {"kind": "QWidget", "text": None, "args": [], "props": {},
                   "line": node.lineno}
        saved = self.widgets.get(loop_var)
        self.widgets[loop_var] = scratch
        before = len(self.adds)
        for stmt in node.body:
            self.generic_visit(stmt)
        body_adds = self.adds[before:]
        del self.adds[before:]
        if saved is None:
            self.widgets.pop(loop_var, None)
        else:
            self.widgets[loop_var] = saved

        for index, name in enumerate(members):
            if name in self.widgets:
                # Properties the body set apply to every member.
                self.widgets[name]["props"].update(
                    {k: v for k, v in scratch["props"].items()})
            for offset, (line, owner, op, payload) in enumerate(body_adds):
                if payload.get("child") != loop_var:
                    continue
                copy = dict(payload)
                copy["child"] = name
                # Fractional line numbers keep the members in source order
                # against everything else added to the same layout.
                self.adds.append((line + (index + offset / 100.0) / 1000.0,
                                  owner, op, copy))

    def visit_Call(self, node):
        fn = node.func
        # `layout.addLayout(self._browse_row(self.field, False))` -- inline the
        # factory, then add whatever it returned.
        # A factory can be the child of addWidget/addLayout, or the *field* of
        # an addRow -- `form.addRow("Peaks root", self._browse_row(field, False))`
        # is how most of Signal Processing's form is written.
        slot = {"addWidget": 0, "addLayout": 0, "addRow": 1}.get(
            fn.attr if isinstance(fn, ast.Attribute) else "")
        if slot is not None and len(node.args) > slot \
                and isinstance(node.args[slot], ast.Call) \
                and isinstance(node.args[slot].func, ast.Attribute) \
                and var_of(node.args[slot].func.value) == "self" \
                and node.args[slot].func.attr in self.methods:
            self.counter += 1
            alias = f"__factory{self.counter}"
            if self.inline_method(node.args[slot].func.attr, node.args[slot], [alias]):
                args = list(node.args)
                args[slot] = ast.Name(id=alias, ctx=ast.Load())
                node = ast.copy_location(
                    ast.Call(func=fn, args=args, keywords=node.keywords), node)
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
                if child is None and isinstance(node.args[0], ast.Call) \
                        and name_of(node.args[0]) == "stacked_field" \
                        and len(node.args[0].args) >= 2:
                    self.counter += 1
                    child = f"__stacked{self.counter}"
                    self.widgets[child] = {
                        "kind": "StackedField",
                        "text": const(node.args[0].args[0]),
                        "args": [],
                        "props": {"field": var_of(node.args[0].args[1])},
                        "line": node.lineno,
                    }
                elif child is None and isinstance(node.args[0], ast.Call):
                    kind = name_of(node.args[0])
                    if kind in WIDGET_KINDS:
                        self.counter += 1
                        child = f"__inline{self.counter}"
                        args = [self.literal(a) for a in node.args[0].args]
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
                if op == "setPlaceholderText" and node.args:
                    self.set_prop(owner, "placeholder", const(node.args[0]))
                elif op == "addItems" and node.args:
                    # `addItems(self._MODELS)` names a class attribute rather
                    # than a literal; Model Fitting's model list is written that
                    # way and the combo came out empty.
                    items = const_list(node.args[0])
                    if not items:
                        named = var_of(node.args[0])
                        items = self.class_lists.get(named, [])
                    if items:
                        self.set_prop(owner, "items", items)
                elif op in ("setHorizontalHeaderLabels", "setHeaderLabels") and node.args:
                    self.set_prop(owner, "headers", const_list(node.args[0]))
                elif op == "setText" and node.args:
                    self.set_prop(owner, "text", const(node.args[0]))
                elif op == "setObjectName" and node.args:
                    self.set_prop(owner, "objectName", const(node.args[0]))
                elif op == "setReadOnly":
                    self.set_prop(owner, "readOnly", bool(const(node.args[0])) if node.args else True)
                elif op == "setChecked":
                    self.set_prop(owner, "checked", bool(const(node.args[0])) if node.args else True)
                elif op in ("setMaximumHeight", "setFixedHeight") and node.args:
                    self.set_prop(owner, "maxHeight", const(node.args[0]))
                elif op == "setFrameShape" and node.args:
                    shape = node.args[0].attr if isinstance(node.args[0], ast.Attribute) else ""
                    self.set_prop(owner, "frame", shape.lower())
                elif op == "setWordWrap":
                    self.set_prop(owner, "wrap", True)
                elif op == "setToolTip" and node.args:
                    self.set_prop(owner, "tip", const(node.args[0]))
                elif op in ("setFixedWidth", "setMaximumWidth") and node.args:
                    self.set_prop(owner, "width", const(node.args[0]))
                elif op == "setMinimumWidth" and node.args:
                    self.set_prop(owner, "minWidth", const(node.args[0]))
                elif op in ("setMinimumHeight",) and node.args:
                    self.set_prop(owner, "minHeight", const(node.args[0]))
                elif op == "setRange" and len(node.args) >= 2:
                    self.set_prop(owner, "range", [const(node.args[0]), const(node.args[1])])
                elif op == "setValue" and node.args:
                    self.set_prop(owner, "value", const(node.args[0]))
                elif op == "setCurrentText" and node.args:
                    self.set_prop(owner, "value", const(node.args[0]))
        self.generic_visit(node)


def build_tree(reader, root_layout):
    """Turn the flat add-list into nested nodes."""
    by_layout = {}
    # Sort on the line and the layout only: two adds can share a line after a
    # loop expansion, and comparing the payload dicts that follow is a TypeError.
    for line, owner, op, payload in sorted(
            reader.adds, key=lambda add: (add[0], str(add[1]), add[2])):
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
            **({"base": CUSTOM_BASE[info["kind"]]} if info["kind"] in CUSTOM_BASE else {}),
            "text": info.get("props", {}).get("text") or info.get("text"),
            **{k: v for k, v in info.get("props", {}).items() if k != "text"},
        }
        if info["kind"] == "StackedField":
            return {"node": "stacked", "label": info.get("text"),
                    "child": render_child(info["props"].get("field"), depth + 1)}
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


def label(text, role=None, wrap=False):
    node = {"node": "widget", "kind": "QLabel", "text": text}
    if role:
        node["objectName"] = role
    if wrap:
        node["wrap"] = True
    return node


def provider_tab(provider):
    """Rebuild `IngestDomainPage._build_provider_tab` from its provider dict.

    The eleven Ingest pages are one class constructed eleven times with
    different `providers` lists, and the tabs are generated from them — so the
    layout tree saw a QTabWidget with nothing in it. The lists are plain
    literals in the source, which means the tabs are static content that merely
    arrives by a different route, and the page is most of what these pages *are*.
    """
    children = [label(provider.get("description", ""), "PageSubtitle", wrap=True)]

    groups = provider.get("source_groups") or []
    if groups:
        grid = {"node": "layout", "kind": "QGridLayout", "children": []}
        for index, group in enumerate(groups):
            card = {
                "node": "widget", "kind": "QGroupBox",
                "text": group.get("title", "Sources"),
                "row": index // 2, "col": index % 2,
                "content": {"node": "layout", "kind": "QVBoxLayout", "children": [
                    label(f"• {entry}", "PageSubtitle", wrap=True)
                    for entry in group.get("entries", [])
                ]},
            }
            grid["children"].append(card)
        children.append(grid)

    # The action travels with the button, so the renderer can do what
    # `_execute_provider_action` does rather than leave it disabled.
    actions = provider.get("actions") or []
    row = {"node": "layout", "kind": "QHBoxLayout", "children": [
        {"node": "widget", "kind": "QPushButton",
         "text": action.get("label", "Action"),
         "action": {k: v for k, v in action.items() if k != "label"},
         "provider": provider.get("name", "Provider")}
        for action in actions
    ] + [{"node": "stretch"}]}
    children.append(row)

    note = provider.get("note", "")
    if note:
        children.append(label(note, "MutedLabel", wrap=True))
    children.append({"node": "stretch"})
    return {"node": "layout", "kind": "QVBoxLayout", "children": children}


def ingest_specs(tree):
    """The `ingest_domain_specs` literal, page name -> spec."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not any(var_of(t) == "ingest_domain_specs" for t in node.targets):
            continue
        try:
            return ast.literal_eval(node.value)
        except (ValueError, SyntaxError):
            return {}
    return {}


def fill_provider_tabs(root, providers, slug=""):
    """Put the generated tabs into the page's empty provider QTabWidget."""
    if isinstance(root, list):
        for item in root:
            fill_provider_tabs(item, providers, slug)
        return
    if not isinstance(root, dict):
        return
    if root.get("node") == "tabs" and root.get("var") == "provider_tabs":
        root["tabs"] = [
            {"label": p.get("name", "Provider"), "content": provider_tab(p)}
            for p in providers
        ]
        root["slug"] = slug
        return
    for key in ("children", "content", "child", "tabs"):
        value = root.get(key)
        if value is None:
            continue
        if isinstance(value, list):
            for item in value:
                fill_provider_tabs(item.get("content") if isinstance(item, dict)
                                   and "label" in item and "content" in item else item,
                                   providers, slug)
        else:
            fill_provider_tabs(value, providers, slug)


def custom_widgets(tree):
    """The app's own widget classes, mapped to the Qt class they extend.

    `CodeEditor()` is a QPlainTextEdit, `ToolInfoButton()` a QPushButton,
    `PlotlyViewer()` a QWidget. They are not in `WIDGET_KINDS` because they are
    not Qt's, so every one of them was skipped — Module Builder's Editor tab
    rendered as an empty box because its only child was a CodeEditor. Learning
    them from their base class costs nothing and cannot go stale.

    Page classes are excluded: those *are* the pages, not widgets inside one.
    """
    out = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef) or node.name.endswith("Page"):
            continue
        for base in node.bases:
            name = base.attr if isinstance(base, ast.Attribute) else getattr(base, "id", "")
            if name in WIDGET_KINDS or name in CONTAINER_KINDS or name in LAYOUT_KINDS:
                out[node.name] = name
                break
            if name in out:                 # a subclass of one of the app's own
                out[node.name] = out[name]
                break
    return out


def extract():
    tree = ast.parse(QT_APP.read_text(encoding="utf-8"), filename=str(QT_APP))
    # Teach the reader the app's own widget classes before anything is read.
    for name, base in custom_widgets(tree).items():
        WIDGET_KINDS.add(name)
        CUSTOM_BASE[name] = base
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
        methods = {m.name: m for m in node.body if isinstance(m, ast.FunctionDef)
                   and m.name != "__init__"}
        reader = PageReader(methods)
        # Class-level list constants, so `addItems(self._MODELS)` resolves.
        for item in node.body:
            if isinstance(item, ast.Assign) and isinstance(item.value, (ast.List, ast.Tuple)):
                values = const_list(item.value)
                if values:
                    for target in item.targets:
                        name = var_of(target)
                        if name:
                            reader.class_lists[name] = values
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
            pages[page_id] = {"qt_class": node.name,
                              "root": copy.deepcopy(built) if len(mapping[node.name]) > 1
                                      else built}

    # The Ingest pages share one class and differ only by the provider list they
    # were constructed with, so each needs its own copy of the tree filled in.
    specs = ingest_specs(tree)
    for page_id, spec in specs.items():
        page = pages.get(page_id)
        if page:
            fill_provider_tabs(page["root"], spec.get("providers", []),
                               spec.get("slug", ""))
            page["slug"] = spec.get("slug", "")
            page["title"] = page_id

    # The hub names these functions for what they do, not for the work that
    # produced them -- see services/qt_names.py.
    rename_tree(pages)
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
    elif node["node"] == "stacked":
        out.append(f"{pad}field: {node['label']}")
        if node.get("child"):
            summarise(node["child"], depth + 1, out)
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
