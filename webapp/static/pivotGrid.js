var grid;

$(function() {
    $("#toolbar").dxToolbar({
	items: [
	    {
		location: "before",
		widget: "dxButton",
		locateInMenu: "auto",
		options: {
		    text: "Reload grid",
		    onClick: function() {
			grid.getDataSource().reload();
		    }
		}
	    }]
    });

    grid = $("#pivotGrid").dxPivotGrid({
	fieldPanel: {
	    visible: true
	},
	dataSource: {
	    remoteOperations: true,
	    store: dataStore,
	    retrieveFields: false,
	    fields: [
		{
		    dataField: "date1",
		    dataType: "date",
		    format: "shortDate",
		    allowFiltering: false,
		    allowSorting: true,
		    allowSortingBySummary: true,
		    area: "column"/*,
		    groupInterval: "dayOfWeek"*/
		},
		{
		    dataField: "date2",
		    dataType: "date",
		    format: "shortDate",
		    allowFiltering: true,
		    allowSorting: true,
		    allowSortingBySummary: true,
		    area: "filter",
		    groupInterval: "quarter"
		},
		{
		    dataField: "int1",
		    dataType: "number",
		    allowFiltering: true,
		    allowSorting: true,
		    allowSortingBySummary: true,
		    area: "data"
		},
		{
		    dataField: "int2",
		    dataType: "number",
		    allowFiltering: true,
		    allowSorting: true,
		    allowSortingBySummary: true,
		    area: "filter",
		    groupInterval: 10
		},
		{
		    dataField: "string",
		    dataType: "string",
		    allowFiltering: true,
		    allowSorting: true,
		    allowSortingBySummary: true,
		    area: "row"
		}
	    ]
	}
    }).dxPivotGrid("instance");
});
