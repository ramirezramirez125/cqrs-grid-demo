const mongodb = require("mongodb");
const ObjectID = mongodb.ObjectID;
const parambulator = require("parambulator");

function sendErrorStatus(m, status, msg="") {
    m.response$.status(status).send({
	message: msg
    });
} 

const errors = { 
    invalid: {
	status: 400,
	message: "Invalid data"
    },
    unknownid: {
	status: 404,
	message: "Invalid ID"
    }
};


function checkError(m, res) {
    if (res && res.err$) {
	const details = errors[res.err$];
	if (details) sendErrorStatus(m, details.status, details.message);
	else sendErrorStatus(m, 500);
	return true;
    }
    return false;
}

module.exports = function(o) {
    this.add("role:web, domain:values, cmd:createTestData", (m, r) => {
	this.act({
	    role: "testing",
	    domain: "values",
	    cmd: "createTestData",
	    count: m.args.query.count
	}, r);
    });
 
    const sortOptionsChecker = parambulator({
	required$: ["desc", "selector"],
	only$: ["desc", "selector"],
	desc: {
	    type$: "boolean"
	},
	selector: {
	    type$: "string"
	}
    }); 

    const groupOptionsChecker = parambulator({
	required$: ["selector"],
	only$: ["desc", "selector", "isExpanded"],
	desc: {
	    type$: "boolean"
	},
	isExpanded: {
	    type$: "boolean"
	},
	selector: {
	    type$: "string"
	}
    });

    function validateAll(list, checker, short = true) {
	return list.reduce((r, v) => {
	    if (short && !r.valid) return r; // short circuiting
	    const newr = checker.validate(v);
	    if (newr) {
		r.errors.push(newr);
		r.valid = false;
	    }
	    return r;
	}, { valid: true, errors: [] });
    }

    this.add("role:web, domain:values, cmd:list", function(m, r) {
	let p = {};

	if (m.args.query.take) {
	    const take = parseInt(m.args.query.take);
	    if (take > 0) p.take = take;
	    else this.log.info("Invalid take parameter found", m.args.query.take);
	}

	if (m.args.query.skip) {
	    const skip = parseInt(m.args.query.skip);
	    if (skip >= 0) p.skip = skip;
	    else this.log.info("Invalid skip parameter found", m.args.query.skip);
	}

	if (m.args.query.sort) {
	    const sortOptions = JSON.parse(m.args.query.sort);

	    if (sortOptions instanceof Array && sortOptions.length > 0) {
		const vr = validateAll(sortOptions, sortOptionsChecker);
		if (vr.valid) p.sort = sortOptions;
		else this.log.info("Sort parameter validation errors", vr.errors);
	    }
	    else this.log.info("Invalid sort parameter found", m.args.query.sort);
	}

	if (m.args.query.group) {
	    const groupOptions = JSON.parse(m.args.query.group);

	    if (groupOptions instanceof Array && groupOptions.length > 0) {
		const vr = validateAll(groupOptions, groupOptionsChecker);
		if (vr.valid) p.group = groupOptions;
		else this.log.info("Group parameter validation errors", vr.errors);
	    }
	    else this.log.info("Invalid group parameter found", m.args.query.group);
	}
	
	this.act({
	    role: "entitiesQuery",
	    domain: "values",
	    cmd: "list",
	    params: p
	}, r);
    });

    this.add("role:web, domain:values, cmd:create", function(m, r) {
	const seneca = this;
	const instance = m.args.body;

	seneca.act({
	    role: "validation",
	    domain: "values",
	    cmd: "validateOne",
	    instance: instance
	}, (err, res) => {
	    if (err) r(err);
	    
	    if (!res.valid) {
		sendErrorStatus(m, 400, res.err$);
		return r();
	    }
	    
	    return seneca.act({
		role: "entitiesCommand",
		domain: "values",
		cmd: "create",
		instance: instance
	    }, function(err, res) {
		if (err) return r(err);
		if (checkError(m, res)) return r();
		
		m.response$.location("/data/v1/values/" + res.id);
		m.response$.sendStatus(201);
		
		return r();
	    });
	});
    });

    this.add("role:web, domain:values, cmd:fetch", function(m, r) {
	const seneca = this;
	const id = m.args.params.id;

	if (!ObjectID.isValid(id)) {
	    sendErrorStatus(m, 404, "Invalid ID");
	    return r();
	}

	return seneca.act({
	    role: "entitiesQuery",
	    domain: "values",
	    cmd: "fetch",
	    id: id
	}, function(err, res) {
	    if (err) return r(err);
	    if (checkError(m, res)) return r();
	    
	    m.response$.status(200).send(res);
	    return r();
	});
    });

    this.add("role:web, domain:values, cmd:update", function(m, r) {
	const seneca = this;
	const id = m.args.params.id;

	if (!ObjectID.isValid(id)) {
	    sendErrorStatus(m, 404, "Invalid ID");
	    return r();
	}

	const instance = m.args.body;

	return seneca.act({
	    role: "entitiesCommand",
	    domain: "values",
	    cmd: "update",
	    id: id,
	    instance: instance
	}, function(err, res) {
	    if (err) return r(err);
	    if (checkError(m, res)) return r();

	    m.response$.sendStatus(204);
	    return r();
	    
	});
    });
};
