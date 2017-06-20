import qs from 'qs';
const _ = require('lodash');

const getSortingParams = loadOptions =>
  loadOptions.sorting && loadOptions.sorting.length > 0
    ? {
        sort: loadOptions.sorting.map(s => ({
          selector: s.columnName,
          desc: s.direction === 'desc'
        }))
      }
    : {};

const getPagingParams = loadOptions => {
  const params = {};
  if (loadOptions.pageSize) {
    params.take = loadOptions.pageSize;
    params.requireTotalCount = true;
  }
  if (loadOptions.currentPage > 0)
    params.skip = loadOptions.currentPage * loadOptions.pageSize;
  return params;
};

const getFilterParams = loadOptions =>
  loadOptions.filters && loadOptions.filters.length > 0
    ? {
        filter: loadOptions.filters.reduce((r, v) => {
          // This 'if' is a workaround - items in the filters collection
          // currently stay in the list when the user enters a value
          // in a filter editor and then deletes it again, only the value
          // field is then empty. So I'm currently ignoring filtering
          // items with empty 'value's -- not quite the right way, since
          // I believe empty values could be valid filters.
          if (v.value) {
            if (r.length > 0) r.push('and');
            r.push([
              v.columnName,
              '=',
              v.columnName === 'int1' ? parseInt(v.value, 10) : v.value
            ]);
          }
          return r;
        }, [])
      }
    : {};

const getGroupParams = loadOptions =>
  loadOptions.grouping && loadOptions.grouping.length > 0
    ? {
        group: loadOptions.grouping.map(g => ({
          selector: g.columnName,
          isExpanded: false
        })),
        requireGroupCount: true,
        skip: undefined,
        take: undefined // always query all groups
      }
    : {};

const createQueryURL = (baseUrl, loadOptions) => {
  const params = Object.assign.apply({}, [
    getSortingParams(loadOptions),
    getPagingParams(loadOptions),
    getFilterParams(loadOptions),
    getGroupParams(loadOptions) // overrides skip and take
  ]);

  console.log('Created params: ', params);

  const query = qs.stringify(params, {
    arrayFormat: 'indices'
  });
  return query ? baseUrl.concat('?', query) : baseUrl;
};

const convertSimpleQueryData = data => ({
  rows: data.data,
  totalCount: data.totalCount
});

const createGroupQueryData = (data, loadOptions) => {
  const isExpanded = groupKey => loadOptions.expandedGroups.includes(groupKey);
  const furtherGroupLevels = groupLevel =>
    groupLevel + 1 < loadOptions.grouping.length;

  function* generateContentQueries(
    list,
    groupLevel = 0,
    parentGroupKey,
    parentFilters = []
  ) {
    function getParentFilters(group) {
      return [
        ...parentFilters,
        {
          columnName: loadOptions.grouping[groupLevel].columnName,
          value: group.key
        }
      ];
    }

    for (let group of list) {
      const groupKey = (parentGroupKey ? `${parentGroupKey}|` : '') + group.key;
      if (isExpanded(groupKey)) {
        if (furtherGroupLevels(groupLevel))
          yield* generateContentQueries(
            group.items,
            groupLevel + 1,
            groupKey,
            getParentFilters(group)
          );
        else
          yield {
            groupKey,
            queryString: createQueryURL(BASEDATA, {
              sorting: loadOptions.sorting,
              pageSize: loadOptions.pageSize,
              currentPage: 0,
              filters: loadOptions.filters.concat(getParentFilters(group))
            })
          };
      }
    }
  }

  let totalCount = 0;

  function* generateRows(list, contentData, groupLevel = 0, parentGroupRow) {
    console.log('generateRows');

    function isPageBoundary(count) {
      const fraction = count / loadOptions.pageSize;
      return fraction > 0 && fraction === Math.trunc(fraction);
    }

    function* yieldRow(row, rowsParent) {
      // rowsParent is the actual parent group row for this row -
      // it differs from parentGroupRow on the generateRows function in
      // that content rows of top-level groups have a rowsParent, but
      // no parentGroupRow.

      if (rowsParent && isPageBoundary(totalCount)) {
        const contRow = Object.assign({}, rowsParent, {
          value: `${rowsParent.value} continued...`,
          column: rowsParent.column
        });
        yield contRow;
        totalCount++;
      }

      // now yield the actual row
      yield row;
      totalCount++;
    }

    function createGroupRow(group) {
      console.log('createGroupRow');

      return {
        _headerKey: `groupRow_${loadOptions.grouping[groupLevel].columnName}`,
        key: (parentGroupRow ? `${parentGroupRow.key}|` : '') + `${group.key}`,
        colspan: parentGroupRow ? parentGroupRow.colspan + 1 : 1,
        value: group.key,
        type: 'groupRow',
        column: {
          name: loadOptions.grouping[groupLevel].columnName,
          title: loadOptions.grouping[groupLevel].columnName
        },
        rows: []
      };
    }

    function* getGroupContent(groupRow, contentData) {
      console.log('getGroupContent');

      const cd = contentData.find(c => c.groupKey === groupRow.key);
      if (cd) {
        console.log(`Found content, yielding ${cd.content.length} rows`);

        for (let row of cd.content)
          yield* yieldRow(row, groupRow);
      }
    }

    for (let group of list) {
      console.log('Handling group: ', group);

      // Top group row
      const groupRow = createGroupRow(group);
      yield* yieldRow(groupRow, parentGroupRow);

      // Is the group expanded?
      if (isExpanded(groupRow.key)) {
        // Are there further group levels?
        if (furtherGroupLevels(groupLevel)) {
          yield* generateRows(
            group.items,
            contentData,
            groupLevel + 1,
            groupRow
          );
        } else {
          // Now we need to return the group content
          yield* getGroupContent(groupRow, contentData);
        }
      }
    }
  }

  function getContentData(groups) {
    console.log('Getting content data');

    const queries = Array.from(generateContentQueries(groups)).map(q =>
      simpleQuery(q.queryString).then(res => ({
        groupKey: q.groupKey,
        content: res.dataFetched ? res.data.rows : undefined
      }))
    );
    return Promise.all(queries);
  }

  console.log('Getting group query data');

  return getContentData(data.data).then(contentData => {
    console.log(
      'Have content data, now returning main result. Content data:',
      contentData
    );

    return {
      rows: Array.from(generateRows(data.data, contentData)),
      totalCount
    };
  });
};

function sendChange(row, add = true, key) {
  console.log(`Sending change with add=${add}, key=${key}: `, row);

  const params = {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    method: add ? 'POST' : 'PUT',
    body: JSON.stringify(row)
  };
  const url = '//localhost:3000/data/v1/values' + (add ? '' : `/${key}`);
  fetch(url, params).catch(r =>
    console.log('Something went wrong POSTing this row: ', row)
  );
}

const commitChanges = ({ added, changed, deleted }) => {
  console.log('committing changes: ', changed);

  if (added && added.length > 0) for (const row of added) sendChange(row);
  if (changed) for (const key in changed) sendChange(changed[key], false, key);
};

const BASEDATA = '//localhost:3000/data/v1/values';

const simpleQuery = queryUrl => {
  return fetch(queryUrl)
    .then(response => response.json())
    .then(data => {
      return {
        dataFetched: true,
        data: convertSimpleQueryData(data)
      };
    })
    .catch(reason => ({
      dataFetched: false,
      reason
    }));
};

const groupQuery = (queryUrl, loadOptions) => {
  return fetch(queryUrl)
    .then(response => response.json())
    .then(data => {
      return createGroupQueryData(data, loadOptions).then(data => {
        return {
          dataFetched: true,
          data
        };
      });
    })
    .catch(reason => ({
      dataFetched: false,
      reason
    }));
};

const createExpandedGroupsString = expandedGroups =>
  expandedGroups ? expandedGroups.join(',') : undefined;

const fetchData = (() => {
  let lastQueryDetails;

  return loadOptions => {
    const queryUrl = createQueryURL(BASEDATA, loadOptions);
    const expandedGroupsString = createExpandedGroupsString(
      loadOptions.expandedGroups
    );

    return new Promise((resolve, reject) => {
      const thisQueryDetails = {
        queryUrl,
        expandedGroupsString,
        pageSize: loadOptions.pageSize,
        currentPage: loadOptions.currentPage
      };
      if (!_.isMatch(lastQueryDetails, thisQueryDetails)) {
        console.log('Querying (decoded): ', decodeURIComponent(queryUrl));

        (loadOptions.grouping && loadOptions.grouping.length > 0
          ? groupQuery(queryUrl, loadOptions)
          : simpleQuery(queryUrl)).then(result => {
          if (result.dataFetched) lastQueryDetails = thisQueryDetails;

          resolve(result);
        });
      } else resolve({ dataFetched: false });
    });
  };
})();

export { fetchData, commitChanges };
