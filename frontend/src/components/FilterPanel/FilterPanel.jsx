import { useState, useEffect } from 'react';
import useGraphStore from '../../store/graphStore';

function CheckboxGroup({ label, icon, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  if (!options || options.length === 0) return null;

  const toggle = (val) => {
    const next = selected.includes(val)
      ? selected.filter((v) => v !== val)
      : [...selected, val];
    onChange(next);
  };

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="material-symbols-outlined text-[14px] text-gray-400">{icon}</span>
        <span className="text-[12px] text-gray-700 flex-1 font-medium">{label}</span>
        {selected.length > 0 && (
          <span className="text-[10px] bg-soft-sage/40 text-deep-olive px-1.5 py-0.5 rounded-full font-medium">
            {selected.length}
          </span>
        )}
        <span
          className="material-symbols-outlined text-[12px] text-gray-400 transition-transform duration-150"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          expand_more
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {options.map((opt) => {
            const on = selected.includes(opt);
            return (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  on
                    ? 'bg-deep-olive text-white border-deep-olive'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-soft-sage hover:text-deep-olive'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SearchableMultiSelect({ label, icon, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  if (!options || options.length === 0) return null;

  const filtered = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  const toggle = (val) => {
    const next = selected.includes(val)
      ? selected.filter((v) => v !== val)
      : [...selected, val];
    onChange(next);
  };

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="material-symbols-outlined text-[14px] text-gray-400">{icon}</span>
        <span className="text-[12px] text-gray-700 flex-1 font-medium">{label}</span>
        {selected.length > 0 && (
          <span className="text-[10px] bg-soft-sage/40 text-deep-olive px-1.5 py-0.5 rounded-full font-medium">
            {selected.length}
          </span>
        )}
        <span
          className="material-symbols-outlined text-[12px] text-gray-400 transition-transform duration-150"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          expand_more
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}...`}
            className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 mb-1.5 focus:border-soft-sage focus:ring-1 focus:ring-soft-sage/40 outline-none"
          />
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {filtered.length === 0 ? (
              <div className="text-[10px] text-gray-400 py-1">No matches</div>
            ) : (
              filtered.map((opt) => {
                const on = selected.includes(opt);
                return (
                  <button
                    key={opt}
                    onClick={() => toggle(opt)}
                    className={`w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors ${
                      on ? 'bg-soft-sage/25 text-deep-olive' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${
                      on ? 'bg-deep-olive border-deep-olive' : 'border-gray-300'
                    }`}>
                      {on && <span className="material-symbols-outlined text-[10px] text-white">check</span>}
                    </span>
                    <span className="truncate">{opt}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TextFilter({ label, icon, value, onChange, placeholder }) {
  return (
    <div className="border-b border-gray-100 last:border-b-0 px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="material-symbols-outlined text-[14px] text-gray-400">{icon}</span>
        <span className="text-[12px] text-gray-700 font-medium">{label}</span>
      </div>
      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder={placeholder}
        className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 focus:border-soft-sage focus:ring-1 focus:ring-soft-sage/40 outline-none"
      />
    </div>
  );
}

function RangeFilter({ label, icon, minVal, maxVal, onMinChange, onMaxChange }) {
  return (
    <div className="border-b border-gray-100 last:border-b-0 px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="material-symbols-outlined text-[14px] text-gray-400">{icon}</span>
        <span className="text-[12px] text-gray-700 font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={minVal ?? ''}
          onChange={(e) => onMinChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="min"
          className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 focus:border-soft-sage focus:ring-1 focus:ring-soft-sage/40 outline-none"
        />
        <span className="text-[10px] text-gray-400">to</span>
        <input
          type="number"
          min={0}
          value={maxVal ?? ''}
          onChange={(e) => onMaxChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="max"
          className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 focus:border-soft-sage focus:ring-1 focus:ring-soft-sage/40 outline-none"
        />
      </div>
    </div>
  );
}

function ToggleFilter({ label, icon, value, onChange }) {
  const on = value === true;
  return (
    <div className="border-b border-gray-100 last:border-b-0 px-3 py-2 flex items-center gap-2">
      <span className="material-symbols-outlined text-[14px] text-gray-400">{icon}</span>
      <span className="text-[12px] text-gray-700 font-medium flex-1">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(on ? null : true)}
        className={`relative inline-flex shrink-0 h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-soft-sage/50 ${
          on ? 'bg-deep-olive' : 'bg-gray-300 hover:bg-gray-400'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
            on ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </div>
  );
}

export default function FilterPanel({ open, onClose }) {
  const {
    filters, filterOptions, filterLoading, filteredCounts,
    setFilter, clearFilters, applyFilters, loadFilterOptions, graphId,
  } = useGraphStore();

  // Load filter options when panel opens
  useEffect(() => {
    if (open && graphId && !filterOptions) {
      loadFilterOptions();
    }
  }, [open, graphId]);

  const activeCount = Object.keys(filters).length;
  const opts = filterOptions || {};

  const handleClear = () => {
    clearFilters();
  };

  return (
    <div
      className={`absolute top-2 sm:top-4 left-2 sm:left-4 z-30 transition-all duration-200 ${
        open ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none'
      }`}
      style={{ width: 280 }}
    >
      <div className="glass-panel rounded-xl shadow-xl border border-gray-200 max-h-[calc(100vh-120px)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[16px] text-deep-olive">filter_list</span>
          <span className="font-label-md text-[10px] text-gray-500 uppercase tracking-wider flex-1">Filters</span>
          {activeCount > 0 && (
            <button
              onClick={handleClear}
              className="font-label-sm text-[10px] uppercase tracking-wider text-deep-olive hover:text-deep-olive/70"
            >
              Clear all
            </button>
          )}
          <button
            onClick={onClose}
            className="p-0.5 text-gray-400 hover:text-deep-olive rounded hover:bg-gray-100 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Summary bar */}
        {filteredCounts && (
          <div className="px-3 py-1.5 bg-soft-sage/20 border-b border-soft-sage/40 flex items-center gap-1.5 shrink-0">
            {filterLoading ? (
              <span className="material-symbols-outlined text-[12px] text-deep-olive/70 animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[12px] text-deep-olive/70">info</span>
            )}
            <span className="text-[11px] text-deep-olive">
              Showing {filteredCounts.filtered_nodes} of {filteredCounts.total_nodes} nodes
            </span>
          </div>
        )}

        {/* Filter controls */}
        <div className="overflow-y-auto flex-1">
          {!filterOptions ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <span className="material-symbols-outlined text-[18px] animate-spin mr-2">progress_activity</span>
              <span className="text-[12px]">Loading options...</span>
            </div>
          ) : (
            <>
              <CheckboxGroup
                label="Category"
                icon="category"
                options={opts.categories}
                selected={filters.categories || []}
                onChange={(v) => setFilter('categories', v)}
              />
              <CheckboxGroup
                label="Function Kind"
                icon="functions"
                options={opts.function_kinds}
                selected={filters.function_kinds || []}
                onChange={(v) => setFilter('function_kinds', v)}
              />
              <CheckboxGroup
                label="Access Level"
                icon="lock"
                options={opts.access_levels}
                selected={filters.access_levels || []}
                onChange={(v) => setFilter('access_levels', v)}
              />
              <SearchableMultiSelect
                label="File"
                icon="description"
                options={opts.files}
                selected={filters.files || []}
                onChange={(v) => setFilter('files', v)}
              />
              <TextFilter
                label="File Pattern"
                icon="text_fields"
                value={filters.file_pattern}
                onChange={(v) => setFilter('file_pattern', v)}
                placeholder="e.g. Store"
              />
              <SearchableMultiSelect
                label="Container"
                icon="class"
                options={opts.containers}
                selected={filters.containers || []}
                onChange={(v) => setFilter('containers', v)}
              />
              <TextFilter
                label="Name Pattern"
                icon="search"
                value={filters.name_pattern}
                onChange={(v) => setFilter('name_pattern', v)}
                placeholder="e.g. dispatch"
              />
              <ToggleFilter
                label="Synthetic"
                icon="smart_toy"
                value={filters.synthetic}
                onChange={(v) => setFilter('synthetic', v)}
              />
              <ToggleFilter
                label="Is Override"
                icon="subdirectory_arrow_right"
                value={filters.is_override}
                onChange={(v) => setFilter('is_override', v)}
              />
              <ToggleFilter
                label="Reachable from Public API"
                icon="public"
                value={filters.reachable_from_public_api}
                onChange={(v) => setFilter('reachable_from_public_api', v)}
              />
              <RangeFilter
                label="In-degree"
                icon="call_received"
                minVal={filters.in_degree_min}
                maxVal={filters.in_degree_max}
                onMinChange={(v) => setFilter('in_degree_min', v)}
                onMaxChange={(v) => setFilter('in_degree_max', v)}
              />
              <RangeFilter
                label="Out-degree"
                icon="call_made"
                minVal={filters.out_degree_min}
                maxVal={filters.out_degree_max}
                onMinChange={(v) => setFilter('out_degree_min', v)}
                onMaxChange={(v) => setFilter('out_degree_max', v)}
              />
            </>
          )}
        </div>

        {/* Footer — Apply / Reset */}
        <div className="px-3 py-2 border-t border-gray-100 bg-white flex items-center gap-2 shrink-0">
          <button
            onClick={handleClear}
            disabled={activeCount === 0}
            className="font-label-sm text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:text-deep-olive hover:border-soft-sage transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reset
          </button>
          <button
            onClick={() => applyFilters()}
            disabled={filterLoading}
            className="flex-1 flex items-center justify-center gap-1.5 font-label-sm text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-md bg-deep-olive text-white hover:bg-deep-olive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {filterLoading ? (
              <>
                <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                Applying…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[14px]">filter_alt</span>
                Apply Filters
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
