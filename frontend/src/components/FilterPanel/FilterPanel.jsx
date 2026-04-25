import { useState, useEffect, useCallback, useRef } from 'react';
import useGraphStore from '../../store/graphStore';

const DEBOUNCE_MS = 300;

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
          <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-medium">
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
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-gray-900'
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
          <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-medium">
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
            className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 mb-1.5 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 outline-none"
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
                      on ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${
                      on ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
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
        className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 outline-none"
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
          className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 outline-none"
        />
        <span className="text-[10px] text-gray-400">to</span>
        <input
          type="number"
          min={0}
          value={maxVal ?? ''}
          onChange={(e) => onMaxChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="max"
          className="w-full text-[11px] bg-white border border-gray-200 rounded px-2 py-1 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 outline-none"
        />
      </div>
    </div>
  );
}

function ToggleFilter({ label, icon, value, onChange }) {
  return (
    <div className="border-b border-gray-100 last:border-b-0 px-3 py-2 flex items-center gap-2">
      <span className="material-symbols-outlined text-[14px] text-gray-400">{icon}</span>
      <span className="text-[12px] text-gray-700 font-medium flex-1">{label}</span>
      <button
        onClick={() => onChange(value === true ? null : true)}
        className={`relative w-8 h-[18px] rounded-full transition-colors ${
          value === true ? 'bg-indigo-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${
            value === true ? 'translate-x-[16px]' : 'translate-x-[2px]'
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

  // Debounced auto-apply
  const timerRef = useRef(null);
  const applyDebounced = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => applyFilters(), DEBOUNCE_MS);
  }, [applyFilters]);

  // Apply filters whenever they change
  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      prevFiltersRef.current = filters;
      applyDebounced();
    }
  }, [filters, applyDebounced]);

  const activeCount = Object.keys(filters).length;
  const opts = filterOptions || {};

  const handleClear = () => {
    clearFilters();
  };

  return (
    <div
      className={`absolute top-12 sm:top-14 right-2 sm:right-4 z-30 transition-all duration-200 ${
        open ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'
      }`}
      style={{ width: 280 }}
    >
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-h-[calc(100vh-120px)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[16px] text-indigo-600">filter_list</span>
          <span className="text-[13px] font-medium text-gray-900 flex-1">Filters</span>
          {activeCount > 0 && (
            <button
              onClick={handleClear}
              className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Clear all
            </button>
          )}
          <button
            onClick={onClose}
            className="p-0.5 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Summary bar */}
        {filteredCounts && (
          <div className="px-3 py-1.5 bg-indigo-50 border-b border-indigo-100 flex items-center gap-1.5 shrink-0">
            {filterLoading ? (
              <span className="material-symbols-outlined text-[12px] text-indigo-500 animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[12px] text-indigo-500">info</span>
            )}
            <span className="text-[11px] text-indigo-700">
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
      </div>
    </div>
  );
}
