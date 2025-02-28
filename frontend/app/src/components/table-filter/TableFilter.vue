<script setup lang="ts">
import type { AssetInfo } from '@rotki/common/lib/data';
import type {
  MatchedKeyword,
  MatchedKeywordWithBehaviour,
  SavedFilterLocation,
  SearchMatcher,
  Suggestion,
} from '@/types/filtering';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    matches: MatchedKeywordWithBehaviour<any>;
    matchers: SearchMatcher<any, any>[];
    location?: SavedFilterLocation;
    disabled?: boolean;
  }>(),
  {
    location: undefined,
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: 'update:matches', matches: MatchedKeywordWithBehaviour<any>): void;
}>();

const { matchers, matches } = toRefs(props);

const input = ref();
const selection = ref<Suggestion[]>([]);

const search = ref('');
const selectedSuggestion = ref(0);
const suggestedFilter = ref<Suggestion>({
  index: 0,
  total: 0,
  asset: false,
  key: '',
  value: '',
});
const validKeys = computed(() => get(matchers).map(({ key }) => key));

const selectedMatcher = computed(() => {
  const searchKey = splitSearch(get(search));
  const key = get(validKeys).find(value => value === searchKey.key);
  return matcherForKey(key) ?? undefined;
});

const usedKeys = computed(() => get(selection).map(entry => entry.key));

function removeSelection(item: Suggestion) {
  const newSelection = get(selection).filter(sel => getSuggestionText(sel).text !== getSuggestionText(item).text);
  updateMatches(newSelection);
}

function clickItem(item: Suggestion) {
  if (typeof item.value !== 'boolean') {
    removeSelection(item);
    selectItem(item);
  }
}

function matcherForKey(searchKey: string | undefined) {
  return get(matchers).find(({ key }) => key === searchKey);
}

function matcherForKeyValue(searchKey: string | undefined) {
  return get(matchers).find(({ keyValue }) => keyValue === searchKey);
}

function setSearchToMatcherKey(matcher: SearchMatcher<any>) {
  const boolean = 'boolean' in matcher;
  if (boolean) {
    applyFilter({
      key: matcher.key,
      asset: false,
      value: true,
      index: 0,
      total: 1,
    });
    return;
  }
  const allowExclusion = 'string' in matcher && matcher.allowExclusion;
  const filter = `${matcher.key}${allowExclusion ? '' : '='}`;
  set(search, filter);
  get(input)?.focus?.();
}

function updateMatches(pairs: Suggestion[]) {
  const matched: Partial<MatchedKeyword<any>> = {};
  const validPairs: Suggestion[] = [];

  for (const entry of pairs) {
    const key = entry.key;
    const matcher = matcherForKey(key);
    if (!matcher)
      continue;

    const valueKey = (matcher.keyValue || matcher.key) as string;
    let transformedKeyword: string | boolean = '';

    if ('string' in matcher) {
      if (typeof entry.value !== 'string')
        continue;

      if (matcher.validate(entry.value)) {
        transformedKeyword = matcher.serializer?.(entry.value) || entry.value;

        if (entry.exclude)
          transformedKeyword = `!${transformedKeyword}`;
      }
      else {
        continue;
      }
    }
    else if ('asset' in matcher) {
      transformedKeyword = typeof entry.value !== 'string' ? entry.value.identifier : entry.value;
    }
    else {
      transformedKeyword = true;
    }

    if (!transformedKeyword)
      continue;

    validPairs.push(entry);

    if (matcher.multiple) {
      if (!matched[valueKey])
        matched[valueKey] = [];

      (matched[valueKey] as (string | boolean)[]).push(transformedKeyword);
    }
    else {
      matched[valueKey] = transformedKeyword;
    }
  }

  set(selection, validPairs);
  emit('update:matches', matched);
}

function applyFilter(filter: Suggestion) {
  let newSelection = [...get(selection)];
  const key = filter.key;
  const index = newSelection.findIndex(value => value.key === key);
  const matcher = matcherForKey(key);
  assert(matcher);

  if (index >= 0 && (!matcher.multiple || newSelection[index].exclude !== filter.exclude))
    newSelection = newSelection.filter(item => item.key !== key);

  newSelection.push(filter);

  updateMatches(newSelection);
  set(search, '');
}

const filteredMatchers = computed<SearchMatcher<any>[]>(() => {
  const filteredByUsedKeys = get(matchers).filter(({ key, multiple }) => !get(usedKeys).includes(key) || multiple);

  const searchVal = get(search);
  if (!searchVal)
    return filteredByUsedKeys;

  const searchToken = getTextToken(searchVal);
  return filteredByUsedKeys
    .filter(({ key }) => getTextToken(key).includes(searchToken))
    .sort((a, b) => compareTextByKeyword(getTextToken(a.key), getTextToken(b.key), searchToken));
});

async function applySuggestion() {
  const selectedIndex = get(selectedSuggestion);
  if (!get(selectedMatcher)) {
    const filteredMatchersVal = get(filteredMatchers);

    if (filteredMatchersVal.length > selectedIndex)
      setSearchToMatcherKey(filteredMatchersVal[selectedIndex]);

    return;
  }

  const filter = get(suggestedFilter);
  if (filter.value) {
    await nextTick(() => applyFilter(filter));
  }
  else {
    const { key, value: keyword, exclude } = splitSearch(get(search));

    const matcher = matcherForKey(key);
    let asset = false;
    if (matcher) {
      let suggestedItems: (AssetInfo | string)[] = [];
      if ('string' in matcher) {
        suggestedItems = matcher.suggestions();
      }
      else if ('asset' in matcher) {
        suggestedItems = await matcher.suggestions(keyword);
        asset = true;
      }
      else if (!('boolean' in matcher)) {
        logger.debug('Matcher doesn\'t have asset=true, string=true, or boolean=true.', selectedMatcher);
      }

      if (suggestedItems.length === 0 && 'validate' in matcher && matcher.validate(keyword)) {
        await nextTick(() =>
          applyFilter({
            key,
            asset,
            value: keyword,
            index: 0,
            total: 1,
            exclude,
          }),
        );
      }
    }
    if (!key)
      get(input).blur();
  }
  set(selectedSuggestion, 0);
  set(search, '');
}

onMounted(() => {
  get(input).onTabDown = function (e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    moveSuggestion(false);
  };
  get(input).onEnterDown = function (e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
  };
});

watch(search, () => {
  set(selectedSuggestion, 0);
});

function moveSuggestion(up: boolean) {
  const total = get(selectedMatcher) ? get(suggestedFilter).total : get(filteredMatchers).length;

  let position = get(selectedSuggestion);
  const move = up ? -1 : 1;

  position += move;

  if (position >= total)
    set(selectedSuggestion, 0);
  else if (position < 0)
    set(selectedSuggestion, total - 1);
  else set(selectedSuggestion, position);
}

// TODO: This is too specific for custom asset, move it!
function getDisplayValue(suggestion: Suggestion) {
  const value = suggestion.value;
  if (typeof value === 'string')
    return value;

  return value.isCustomAsset ? value.name : value.symbol;
}

function getSuggestionText(suggestion: Suggestion) {
  const operator = suggestion.exclude ? '!=' : '=';
  const startSelection = suggestion.key.length + operator.length;
  const value = getDisplayValue(suggestion);
  return {
    text: `${suggestion.key}${operator}${value}`,
    startSelection,
    endSelection: startSelection + value.length,
  };
}

async function selectItem(suggestion: Suggestion) {
  await nextTick(async () => {
    const suggestionText = getSuggestionText(suggestion);
    set(search, suggestionText.text);
    await nextTick(() => {
      get(input)?.setSelectionRange?.(suggestionText.startSelection, suggestionText.endSelection);
    });
  });
}

function restoreSelection(matches: MatchedKeywordWithBehaviour<any>): void {
  const oldSelection = get(selection);
  const newSelection: Suggestion[] = [];
  Object.entries(matches).forEach(([key, value]) => {
    const foundMatchers = matcherForKeyValue(key);

    if (!(foundMatchers && value))
      return;

    const values = Array.isArray(value) ? value : [value];
    const asset = 'asset' in foundMatchers;
    const boolean = 'boolean' in foundMatchers;

    values.forEach((value) => {
      let deserializedValue = null;
      if (asset) {
        const prevAssetSelection = oldSelection.find(({ key }) => key === foundMatchers.key);
        if (prevAssetSelection)
          deserializedValue = prevAssetSelection.value;
      }

      let exclude = false;
      if (!deserializedValue) {
        if (boolean || typeof value === 'boolean') {
          deserializedValue = true;
        }
        else if (typeof value === 'string') {
          let normalizedValue = value;
          if (!asset && value.startsWith('!')) {
            normalizedValue = value.substring(1);
            exclude = true;
          }
          deserializedValue = foundMatchers.deserializer?.(normalizedValue) || normalizedValue;
        }
      }

      newSelection.push({
        key: foundMatchers.key,
        value: deserializedValue,
        asset,
        total: 1,
        index: 0,
        exclude,
      });
    });
  });

  set(selection, newSelection);
}

onMounted(() => {
  restoreSelection(get(matches));
});

watch(matches, (matches) => {
  restoreSelection(matches);
});

const slots = useSlots();
const { t } = useI18n();
</script>

<template>
  <RuiTooltip
    :popper="{ placement: 'top' }"
    :disabled="!disabled || !slots.tooltip"
    :open-delay="400"
    :close-delay="1000"
    class="block flex-1"
    tooltip-class="max-w-[12rem]"
  >
    <template #activator>
      <div
        class="flex items-center gap-2"
        data-cy="table-filter"
      >
        <RuiAutoComplete
          ref="input"
          v-model:search-input="search"
          :model-value="selection"
          variant="outlined"
          dense
          :disabled="disabled"
          :label="t('table_filter.label')"
          clearable
          hide-details
          custom-value
          :options="[]"
          return-object
          disable-interaction
          v-bind="$attrs"
          @update:model-value="updateMatches($event)"
          @keydown.enter="applySuggestion()"
          @keydown.up.prevent="moveSuggestion(true)"
          @keydown.down.prevent="moveSuggestion(false)"
        >
          <template #selection="{ item, chipAttrs }">
            <RuiChip
              tile
              size="sm"
              class="font-medium !py-0"
              clickable
              closeable
              v-bind="chipAttrs"
              @click="clickItem(item)"
            >
              <SuggestedItem
                chip
                :suggestion="item"
              />
            </RuiChip>
          </template>
          <template #no-data>
            <FilterDropdown
              class="py-4"
              :matchers="filteredMatchers"
              :keyword="search"
              :selected-matcher="selectedMatcher"
              :selected-suggestion="selectedSuggestion"
              @apply-filter="applyFilter($event)"
              @suggest="suggestedFilter = $event"
              @click="setSearchToMatcherKey($event)"
            />
          </template>
        </RuiAutoComplete>

        <SavedFilterManagement
          v-if="location"
          :disabled="disabled"
          :selection="selection"
          :location="location"
          :matchers="matchers"
          @update:matches="updateMatches($event)"
        />
      </div>
    </template>
    <slot name="tooltip" />
  </RuiTooltip>
</template>
