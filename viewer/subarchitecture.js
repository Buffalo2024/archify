    Archify.subarchitecture = (function () {
      var html = document.documentElement;
      var parentSvg = document.querySelector('.diagram-container > svg');
      var drawer = document.getElementById('subarchitecture-drawer');
      var mount = document.getElementById('subarchitecture-mount');
      var drawerTitle = document.getElementById('subarchitecture-title');
      var trigger = document.getElementById('btn-focus-internals');
      var backBtn = document.getElementById('subarchitecture-back');
      var closeBtn = document.getElementById('subarchitecture-close');
      var copyBtn = document.getElementById('subarchitecture-copy');
      var passport = document.getElementById('subarchitecture-passport');
      var passportTitle = document.getElementById('subarchitecture-passport-title');
      var passportDetail = document.getElementById('subarchitecture-passport-detail');
      var passportEmpty = document.getElementById('subarchitecture-passport-empty');
      var passportSummary = document.getElementById('subarchitecture-passport-summary');
      var relationshipList = document.getElementById('subarchitecture-relations');
      var intentStatus = document.getElementById('subarchitecture-intent-trace-status');
      var svgNamespace = 'http://www.w3.org/2000/svg';
      var mountedSvg = null;
      var activeParentId = null;
      var activeChildId = null;
      var intentActiveId = null;
      var intentHoveredNode = null;
      var intentFocusedNode = null;
      var intentEnterTimer = null;
      var drawerFrame = 0;
      var returnScroll = null;
      var listeners = [];
      var destroyed = false;

      function listen(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        listeners.push({ target: target, type: type, handler: handler, options: options });
      }

      function templateFor(parentId) {
        return inspectSubarchitectureTemplate(parentId);
      }
      function markUnavailable(parentId) {
        if (Archify.focus && Archify.focus.active() === parentId) {
          trigger.hidden = true;
          trigger.disabled = true;
          trigger.title = viewerText('viewer.subarchitecture.unavailable');
          trigger.setAttribute('aria-expanded', 'false');
        }
      }
      function localNodes() {
        return mountedSvg ? Array.prototype.slice.call(mountedSvg.querySelectorAll('[data-node-id]')) : [];
      }
      function localEdges() {
        return mountedSvg ? Array.prototype.slice.call(mountedSvg.querySelectorAll('[data-edge-from][data-edge-to]')) : [];
      }
      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') || (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '');
      }
      function edgeKey(edge) {
        return edge.getAttribute('data-edge-key') || (
          edge.getAttribute('data-edge-from') + '\u0000' +
          edge.getAttribute('data-edge-to') + '\u0000' +
          (edge.getAttribute('data-edge-label') || '')
        );
      }
      function finePointer() {
        return !window.matchMedia || window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      }
      function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      }
      function localIntentBlocked() {
        return !mountedSvg || drawer.hidden ||
          html.getAttribute('data-embed') === 'true' ||
          html.getAttribute('data-guide-open') === 'true' ||
          mountedSvg.hasAttribute('data-focus-active') ||
          mountedSvg.hasAttribute('data-lens-active') ||
          mountedSvg.hasAttribute('data-story-active') ||
          mountedSvg.hasAttribute('data-relationship-preview-active');
      }
      function localIntentEdgeShapes(edge) {
        if (/^(path|line|polyline)$/i.test(edge.tagName)) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function removeLocalIntentOverlay() {
        if (!mountedSvg) return;
        Array.prototype.forEach.call(mountedSvg.querySelectorAll('[data-intent-trace-overlay]'), function (overlay) {
          overlay.remove();
        });
      }
      function clearLocalIntentTrace(options) {
        options = options || {};
        if (intentEnterTimer) window.clearTimeout(intentEnterTimer);
        intentEnterTimer = null;
        intentActiveId = null;
        if (mountedSvg) {
          mountedSvg.removeAttribute('data-intent-trace-active');
          removeLocalIntentOverlay();
          localNodes().forEach(function (node) {
            node.removeAttribute('data-intent-trace-match');
            node.removeAttribute('data-intent-trace-selected');
          });
          localEdges().forEach(function (edge) { edge.removeAttribute('data-intent-trace-match'); });
        }
        if (options.announce !== false) intentStatus.textContent = '';
      }
      function localIntentGeometry(shape, direction) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-labelledby');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-intent-trace-match');
        clone.removeAttribute('data-intent-trace-selected');
        clone.setAttribute('class', 'intent-trace-flow');
        clone.setAttribute('data-direction', direction);
        clone.setAttribute('pathLength', '1');
        return clone;
      }
      function showLocalIntentTrace(id, options) {
        options = options || {};
        if (!id || localIntentBlocked()) {
          clearLocalIntentTrace({ announce: false });
          return false;
        }
        if (intentActiveId === id) return true;
        clearLocalIntentTrace({ announce: false });
        var nodeList = localNodes();
        var edgeList = localEdges();
        var byId = Object.create(null);
        nodeList.forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        var selected = byId[id];
        if (!selected) return false;

        var overlay = document.createElementNS(svgNamespace, 'g');
        overlay.setAttribute('class', 'intent-trace-overlay');
        overlay.setAttribute('data-intent-trace-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        var related = Object.create(null);
        var seen = Object.create(null);
        var counts = { out: 0, in: 0, loop: 0 };
        related[id] = true;

        edgeList.forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (from !== id && to !== id) return;
          var direction = from === id && to === id ? 'loop' : (from === id ? 'out' : 'in');
          var key = edgeKey(edge);
          if (!seen[key]) {
            seen[key] = true;
            counts[direction] += 1;
          }
          related[from] = true;
          related[to] = true;
          edge.setAttribute('data-intent-trace-match', '');
          var wrapper = document.createElementNS(svgNamespace, 'g');
          if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
          localIntentEdgeShapes(edge).forEach(function (shape) {
            wrapper.appendChild(localIntentGeometry(shape, direction));
          });
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });

        nodeList.forEach(function (node) {
          var nodeId = node.getAttribute('data-node-id');
          if (related[nodeId]) node.setAttribute('data-intent-trace-match', '');
          if (nodeId === id) node.setAttribute('data-intent-trace-selected', '');
        });
        if (overlay.childNodes.length) {
          var firstEdge = edgeList[0];
          var firstNode = mountedSvg.querySelector('[data-node-id]');
          if (firstEdge && firstEdge.parentNode) firstEdge.parentNode.insertBefore(overlay, firstEdge);
          else if (firstNode) mountedSvg.insertBefore(overlay, firstNode);
          else mountedSvg.appendChild(overlay);
        }
        intentActiveId = id;
        mountedSvg.setAttribute('data-intent-trace-active', id);
        if (options.announce === true) {
          var total = counts.out + counts.in + counts.loop;
          intentStatus.textContent = viewerText('viewer.intent.summary', {
            label: nodeLabel(selected, id),
            out: counts.out,
            in: counts.in,
            loops: counts.loop ? viewerText('viewer.intent.loops', { count: counts.loop }) : '',
            total: total
          });
        }
        return true;
      }
      function scheduleLocalIntentTrace(node) {
        if (intentEnterTimer) window.clearTimeout(intentEnterTimer);
        intentEnterTimer = window.setTimeout(function () {
          intentEnterTimer = null;
          if (intentHoveredNode === node) showLocalIntentTrace(node.getAttribute('data-node-id'), { announce: false });
        }, reducedMotion() ? 0 : 90);
      }
      function syncLocalIntentTrace() {
        var candidate = intentFocusedNode || intentHoveredNode;
        if (!candidate || !candidate.isConnected) {
          clearLocalIntentTrace();
          return;
        }
        showLocalIntentTrace(candidate.getAttribute('data-node-id'), { announce: candidate === intentFocusedNode });
      }
      function setPassportValue(selector, value) {
        var element = passport.querySelector(selector);
        var normalized = value == null ? '' : String(value).trim();
        element.textContent = normalized;
        element.hidden = !normalized;
      }
      function clearRelationshipPreview() {
        if (!mountedSvg) return;
        mountedSvg.removeAttribute('data-relationship-preview-active');
        localEdges().forEach(function (edge) { edge.removeAttribute('data-relationship-preview'); });
        localNodes().forEach(function (node) {
          node.removeAttribute('data-relationship-preview-node');
          node.removeAttribute('data-relationship-preview-source');
          node.removeAttribute('data-relationship-preview-target');
        });
      }
      function previewRelationship(button) {
        clearLocalIntentTrace({ announce: false });
        clearRelationshipPreview();
        if (!button || !mountedSvg) return;
        var key = button.getAttribute('data-local-relationship-key');
        var from = button.getAttribute('data-relationship-from');
        var to = button.getAttribute('data-relationship-to');
        if (!key || !from || !to) return;
        mountedSvg.setAttribute('data-relationship-preview-active', key);
        localEdges().forEach(function (edge) {
          if (edgeKey(edge) === key) edge.setAttribute('data-relationship-preview', '');
        });
        localNodes().forEach(function (node) {
          var id = node.getAttribute('data-node-id');
          if (id !== from && id !== to) return;
          node.setAttribute('data-relationship-preview-node', '');
          if (id === from) node.setAttribute('data-relationship-preview-source', '');
          if (id === to) node.setAttribute('data-relationship-preview-target', '');
        });
      }
      function relationshipsFor(id, byId) {
        var seen = Object.create(null);
        var relationships = [];
        localEdges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (from !== id && to !== id) return;
          var key = edgeKey(edge);
          if (seen[key]) return;
          seen[key] = true;
          var direction = from === id && to === id ? 'loop' : (from === id ? 'out' : 'in');
          var neighborId = direction === 'in' ? from : to;
          relationships.push({
            key: key,
            from: from,
            to: to,
            direction: direction,
            neighborId: neighborId,
            neighborLabel: byId[neighborId] ? nodeLabel(byId[neighborId], neighborId) : neighborId,
            label: edge.getAttribute('data-edge-label') || viewerText(direction === 'out'
              ? 'viewer.passport.relationship.connectsTo'
              : direction === 'in'
                ? 'viewer.passport.relationship.connectsFrom'
                : 'viewer.passport.relationship.loopsBack')
          });
        });
        return relationships;
      }
      function renderRelationshipList(id, byId) {
        var relationships = relationshipsFor(id, byId);
        var counts = { out: 0, in: 0, loop: 0 };
        relationships.forEach(function (relationship) { counts[relationship.direction] += 1; });
        passportSummary.textContent = viewerText('viewer.passport.relationship.summary', {
          out: counts.out,
          in: counts.in,
          loops: counts.loop ? viewerText('viewer.passport.relationship.loops', { count: counts.loop }) : ''
        });
        relationshipList.textContent = '';
        [
          { id: 'out', label: viewerText('viewer.passport.relationship.group.out') },
          { id: 'in', label: viewerText('viewer.passport.relationship.group.in') },
          { id: 'loop', label: viewerText('viewer.passport.relationship.group.loop') }
        ].forEach(function (group) {
          var items = relationships.filter(function (relationship) { return relationship.direction === group.id; });
          if (!items.length) return;
          var section = document.createElement('div');
          section.className = 'relationship-lens-group';
          var heading = document.createElement('span');
          heading.className = 'relationship-lens-group-title';
          heading.textContent = group.label + ' · ' + items.length;
          section.appendChild(heading);
          items.forEach(function (relationship) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'relationship-lens-row';
            button.setAttribute('data-direction', relationship.direction);
            button.setAttribute('data-local-relationship-target', relationship.neighborId);
            button.setAttribute('data-local-relationship-key', relationship.key);
            button.setAttribute('data-relationship-from', relationship.from);
            button.setAttribute('data-relationship-to', relationship.to);
            button.setAttribute('aria-label', viewerText('viewer.passport.relationship.row', {
              group: group.label,
              relationship: relationship.label,
              neighbor: relationship.neighborLabel
            }));
            var direction = document.createElement('span');
            direction.className = 'relationship-lens-direction';
            direction.setAttribute('aria-hidden', 'true');
            direction.textContent = viewerText(relationship.direction === 'out'
              ? 'viewer.passport.relationship.direction.out'
              : relationship.direction === 'in'
                ? 'viewer.passport.relationship.direction.in'
                : 'viewer.passport.relationship.direction.loop');
            var target = document.createElement('strong');
            target.textContent = relationship.neighborLabel;
            var relation = document.createElement('small');
            relation.textContent = relationship.label;
            button.appendChild(direction);
            button.appendChild(target);
            button.appendChild(relation);
            section.appendChild(button);
          });
          relationshipList.appendChild(section);
        });
      }
      function resetLocalPassport() {
        passportTitle.textContent = viewerText('viewer.subarchitecture.passport.emptyTitle');
        passportDetail.textContent = '';
        passportDetail.hidden = true;
        ['kind', 'context', 'tag', 'brand', 'id'].forEach(function (name) {
          setPassportValue('[data-local-passport="' + name + '"]', '');
        });
        passportEmpty.hidden = false;
        passportEmpty.textContent = viewerText('viewer.subarchitecture.passport.empty');
        passportSummary.textContent = '';
        relationshipList.textContent = '';
        copyBtn.hidden = true;
      }
      function renderLocalPassport(id, node) {
        passportTitle.textContent = nodeLabel(node, id);
        var detailValue = node.getAttribute('data-node-sublabel') || '';
        passportDetail.textContent = detailValue;
        passportDetail.hidden = !detailValue;
        setPassportValue('[data-local-passport="kind"]', viewerKindLabel(node.getAttribute('data-node-kind') || 'node'));
        setPassportValue('[data-local-passport="context"]', node.getAttribute('data-node-context'));
        setPassportValue('[data-local-passport="tag"]', node.getAttribute('data-node-tag'));
        setPassportValue('[data-local-passport="brand"]', node.getAttribute('data-node-brand'));
        setPassportValue('[data-local-passport="id"]', id);
        passportEmpty.hidden = true;
        copyBtn.hidden = false;
        var byId = Object.create(null);
        localNodes().forEach(function (item) { byId[item.getAttribute('data-node-id')] = item; });
        renderRelationshipList(id, byId);
      }
      function updateHash() {
        if (!activeParentId) return;
        var hash = subarchitectureHash(activeParentId, activeChildId);
        try { history.replaceState(null, '', location.pathname + location.search + hash); } catch (_) {}
      }
      function subarchitectureHash(parentId, childId) {
        return '#subgraph=' + encodeURIComponent(parentId) + (childId
          ? '&subfocus=' + encodeURIComponent(childId)
          : '');
      }
      function parseSubarchitectureHash() {
        var params = new URLSearchParams(location.hash.replace(/^#/, ''));
        var parents = params.getAll('subgraph');
        var children = params.getAll('subfocus');
        if (!parents.length && !children.length) return { state: 'absent' };
        var allowed = true;
        params.forEach(function (_, key) {
          if (key !== 'subgraph' && key !== 'subfocus') allowed = false;
        });
        if (!allowed || parents.length !== 1 || children.length > 1 || !parents[0] || (children.length && !children[0])) {
          return { state: 'invalid' };
        }
        return { state: 'valid', parentId: parents[0], childId: children[0] || null };
      }
      function clearLocalFocus(options) {
        options = options || {};
        clearLocalIntentTrace({ announce: false });
        if (mountedSvg) {
          mountedSvg.removeAttribute('data-focus-active');
          localNodes().forEach(function (node) {
            node.removeAttribute('data-focus-match');
            node.removeAttribute('data-focus-selected');
            node.setAttribute('aria-pressed', 'false');
          });
          localEdges().forEach(function (edge) { edge.removeAttribute('data-focus-match'); });
        }
        clearRelationshipPreview();
        activeChildId = null;
        resetLocalPassport();
        if (options.updateUrl !== false) updateHash();
      }
      function focusLocal(id, options) {
        options = options || {};
        if (!mountedSvg) return false;
        var node = localNodes().find(function (item) { return item.getAttribute('data-node-id') === id; });
        if (!node) return false;
        clearLocalFocus({ updateUrl: false });
        activeChildId = id;
        var related = Object.create(null);
        related[id] = true;
        localEdges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (from !== id && to !== id) return;
          edge.setAttribute('data-focus-match', '');
          related[from] = true;
          related[to] = true;
        });
        localNodes().forEach(function (item) {
          var nodeId = item.getAttribute('data-node-id');
          if (related[nodeId]) item.setAttribute('data-focus-match', '');
          if (nodeId === id) {
            item.setAttribute('data-focus-selected', '');
            item.setAttribute('aria-pressed', 'true');
          }
        });
        mountedSvg.setAttribute('data-focus-active', id);
        renderLocalPassport(id, node);
        if (options.updateUrl !== false) updateHash();
        return true;
      }
      function open(parentId, options) {
        options = options || {};
        if (destroyed) return false;
        if (html.getAttribute('data-embed') === 'true') return false;
        var inspected = templateFor(parentId);
        if (!inspected) {
          markUnavailable(parentId);
          return false;
        }
        var template = inspected.template;
        var nextSvg;
        try { nextSvg = inspected.svg.cloneNode(true); } catch (_) {
          markUnavailable(parentId);
          return false;
        }
        if (options.childId && !Array.prototype.some.call(nextSvg.querySelectorAll('[data-node-id]'), function (node) {
          return node.getAttribute('data-node-id') === options.childId;
        })) return false;
        nextSvg.setAttribute('data-preset', html.getAttribute('data-preset') || 'classic');
        nextSvg.setAttribute('data-theme', html.getAttribute('data-theme') || 'dark');
        var previousScroll = returnScroll || { x: window.scrollX, y: window.scrollY };
        if (activeParentId && activeParentId !== parentId) close({ updateUrl: false, restoreFocus: false });
        returnScroll = previousScroll;
        clearLocalIntentTrace({ announce: false });
        intentHoveredNode = null;
        intentFocusedNode = null;
        mountedSvg = nextSvg;
        activeParentId = parentId;
        activeChildId = null;
        mount.replaceChildren(nextSvg);
        drawerTitle.textContent = template.getAttribute('data-subarchitecture-title') || viewerText('viewer.subarchitecture.title');
        drawer.hidden = false;
        html.setAttribute('data-subarchitecture-open', 'true');
        if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') {
          Archify.readerLayout.schedule();
        }
        trigger.setAttribute('aria-expanded', 'true');
        trigger.disabled = false;
        trigger.removeAttribute('title');
        localNodes().forEach(function (node) { node.setAttribute('aria-pressed', 'false'); });
        resetLocalPassport();
        if (Archify.exportMenu && typeof Archify.exportMenu.syncTarget === 'function') {
          Archify.exportMenu.syncTarget();
        }
        if (options.childId) focusLocal(options.childId, { updateUrl: false });
        if (options.updateUrl !== false) updateHash();
        if (drawerFrame) cancelAnimationFrame(drawerFrame);
        drawerFrame = requestAnimationFrame(function () {
          drawerFrame = requestAnimationFrame(function () {
            drawerFrame = 0;
            drawer.scrollIntoView({ block: 'start', behavior: 'instant' });
            try { backBtn.focus({ preventScroll: true }); } catch (_) {}
          });
        });
        return true;
      }
      function close(options) {
        options = options || {};
        if (!activeParentId) return false;
        var parentId = activeParentId;
        var previousScroll = returnScroll;
        returnScroll = null;
        if (drawerFrame) {
          cancelAnimationFrame(drawerFrame);
          drawerFrame = 0;
        }
        clearLocalFocus({ updateUrl: false });
        intentHoveredNode = null;
        intentFocusedNode = null;
        mount.replaceChildren();
        mountedSvg = null;
        activeParentId = null;
        drawer.hidden = true;
        html.removeAttribute('data-subarchitecture-open');
        if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') {
          Archify.readerLayout.schedule();
        }
        trigger.setAttribute('aria-expanded', 'false');
        if (Archify.exportMenu && typeof Archify.exportMenu.syncTarget === 'function') {
          Archify.exportMenu.syncTarget();
        }
        if (options.updateUrl !== false) {
          try { history.replaceState(null, '', location.pathname + location.search + '#focus=' + encodeURIComponent(parentId)); } catch (_) {}
        }
        if (options.restoreFocus !== false) {
          var parentNode = Array.prototype.find.call(parentSvg.querySelectorAll('[data-node-id]'), function (node) {
            return node.getAttribute('data-node-id') === parentId;
          });
          var focusTarget = !trigger.hidden && !trigger.disabled ? trigger : parentNode;
          if (focusTarget) {
            try { focusTarget.focus({ preventScroll: true }); } catch (_) { try { focusTarget.focus(); } catch (_) {} }
          }
          if (previousScroll) {
            window.scrollTo({ left: previousScroll.x, top: previousScroll.y, behavior: 'instant' });
            drawerFrame = requestAnimationFrame(function () {
              drawerFrame = requestAnimationFrame(function () {
                drawerFrame = 0;
                window.scrollTo({ left: previousScroll.x, top: previousScroll.y, behavior: 'instant' });
              });
            });
          }
        }
        return true;
      }
      function destroy() {
        if (destroyed) return;
        if (activeParentId) close({ updateUrl: false, restoreFocus: false });
        destroyed = true;
        if (drawerFrame) cancelAnimationFrame(drawerFrame);
        drawerFrame = 0;
        clearLocalIntentTrace({ announce: false });
        listeners.forEach(function (record) {
          record.target.removeEventListener(record.type, record.handler, record.options);
        });
        listeners = [];
      }
      function escape() {
        if (!activeParentId) return false;
        if (activeChildId) {
          clearLocalFocus();
          return true;
        }
        return close();
      }
      function syncFromHash() {
        try {
          var parsed = parseSubarchitectureHash();
          if (parsed.state === 'absent') {
            if (activeParentId) close({ updateUrl: false, restoreFocus: false });
            return;
          }
          if (parsed.state !== 'valid' || !templateFor(parsed.parentId)) {
            if (activeParentId) close({ updateUrl: false, restoreFocus: false });
            if (parsed.parentId) markUnavailable(parsed.parentId);
            return;
          }
          Archify.focus.set(parsed.parentId, { toggle: false, updateUrl: false });
          if (!open(parsed.parentId, { childId: parsed.childId, updateUrl: false }) && activeParentId) {
            close({ updateUrl: false, restoreFocus: false });
          }
        } catch (_) {}
      }

      listen(trigger, 'click', function () {
        var parentId = Archify.focus.active();
        if (typeof parentId !== 'string') return;
        if (activeParentId === parentId) close();
        else open(parentId);
      });
      listen(backBtn, 'click', function () { close(); });
      listen(closeBtn, 'click', function () { close(); });
      listen(document.getElementById('btn-focus-clear'), 'click', function () {
        close({ updateUrl: false, restoreFocus: false });
      });
      listen(mount, 'click', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node) return;
        focusLocal(node.getAttribute('data-node-id'));
      });
      listen(mount, 'pointerover', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || !finePointer() || event.pointerType === 'touch') return;
        if (event.relatedTarget && node.contains(event.relatedTarget)) return;
        intentHoveredNode = node;
        scheduleLocalIntentTrace(node);
      });
      listen(mount, 'pointerout', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.relatedTarget && node.contains(event.relatedTarget))) return;
        if (intentHoveredNode === node) intentHoveredNode = null;
        syncLocalIntentTrace();
      });
      listen(mount, 'focusin', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node) return;
        intentFocusedNode = node;
        showLocalIntentTrace(node.getAttribute('data-node-id'), { announce: true });
      });
      listen(mount, 'focusout', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.relatedTarget && node.contains(event.relatedTarget))) return;
        if (intentFocusedNode === node) intentFocusedNode = null;
        syncLocalIntentTrace();
      });
      listen(mount, 'pointerdown', function (event) {
        if (!event.target.closest('[data-node-id]')) clearLocalIntentTrace({ announce: false });
      });
      listen(mount, 'keydown', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        focusLocal(node.getAttribute('data-node-id'));
      });
      listen(relationshipList, 'click', function (event) {
        var row = event.target.closest('[data-local-relationship-target]');
        if (!row) return;
        focusLocal(row.getAttribute('data-local-relationship-target'));
      });
      listen(relationshipList, 'pointerover', function (event) {
        var row = event.target.closest('[data-local-relationship-key]');
        if (row) previewRelationship(row);
      });
      listen(relationshipList, 'pointerout', function (event) {
        var row = event.target.closest('[data-local-relationship-key]');
        if (row && (!event.relatedTarget || !row.contains(event.relatedTarget))) clearRelationshipPreview();
      });
      listen(relationshipList, 'focusin', function (event) {
        var row = event.target.closest('[data-local-relationship-key]');
        if (row) previewRelationship(row);
      });
      listen(relationshipList, 'focusout', function (event) {
        var row = event.target.closest('[data-local-relationship-key]');
        if (row && (!event.relatedTarget || !row.contains(event.relatedTarget))) clearRelationshipPreview();
      });
      listen(copyBtn, 'click', function () {
        if (!activeParentId || !activeChildId) return;
        var value = location.href.replace(/#.*$/, '') + subarchitectureHash(activeParentId, activeChildId);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value);
      });
      listen(parentSvg, 'click', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (activeParentId && node && node.getAttribute('data-node-id') !== activeParentId) {
          close({ updateUrl: false, restoreFocus: false });
        }
      });
      listen(window, 'blur', function () { clearLocalIntentTrace({ announce: false }); });
      listen(window, 'hashchange', syncFromHash);
      syncFromHash();

      return {
        open: open,
        close: close,
        escape: escape,
        focus: focusLocal,
        clear: clearLocalFocus,
        destroy: destroy,
        active: function () { return activeParentId; },
        child: function () { return activeChildId; },
        syncFromHash: syncFromHash
      };
    })();
