var Class = require("./Class");
eval(Class.$import("./classdef"));
eval(Class.$import("./expression"));
eval(Class.$import("./type"));
eval(Class.$import("./util"));

"use strict";

var Statement = exports.Statement = Class.extend({

	// returns whether or not to continue analysing the following statements
	analyze: function (context) {
		if (! (this instanceof CaseStatement || this instanceof DefaultStatement))
			if (! Statement.assertIsReachable(context, this.getToken()))
				return false;
		try {
			return this.doAnalyze(context);
		} catch (e) {
			var token = this.getToken();
			console.log("fatal error while compiling statement at file: " + token.getFilename() + ", line " + token.getLineNumber());
			throw e;
		}
	},

	getToken: null, // returns a token of the statement

	serialize: null,

	doAnalyze: null, // void doAnalyze(context), returns whether or not to continue analysing the following statements

	$assertIsReachable: function (context, token) {
		if (context.getTopBlock().localVariableStatuses == null) {
			context.errors.push(new CompileError(token, "the code is unreachable"));
			return false;
		}
		return true;
	}

});

var ConstructorInvocationStatement = exports.ConstructorInvocationStatement = Statement.extend({

	constructor: function (qualifiedName, args) {
		this._qualifiedName = qualifiedName;
		this._args = args;
		this._ctorClassDef = null;
		this._ctorType = null;
	},

	getToken: function () {
		return this._qualifiedName.getToken();
	},

	serialize: function () {
		return [
			"ConstructorInvocationStatement",
			this._qualifiedName.serialize(),
			Util.serializeArray(this._args)
		];
	},

	getQualifiedName: function () {
		return this._qualifiedName;
	},

	getArguments: function () {
		return this._args;
	},

	getConstructingClassDef: function () {
		return this._ctorClassDef;
	},

	getConstructorType: function () {
		return this._ctorType;
	},

	doAnalyze: function (context) {
		if (this._qualifiedName.getImport() == null && this._qualifiedName.getToken().getValue() == "super") {
			this._ctorClassDef = context.funcDef.getClassDef().extendClassDef();
		} else {
			if ((this._ctorClassDef = this._qualifiedName.getClass(context)) == null) {
				// error should have been reported already
				return true;
			}
		}
		// analyze args
		var argTypes = Util.analyzeArgs(context, this._args, null);
		if (argTypes == null) {
			// error is reported by callee
			return true;
		}
		var ctorType = this._ctorClassDef.getMemberTypeByName("constructor", ClassDefinition.GET_MEMBER_MODE_CLASS_ONLY);
		if (ctorType == null) {
			if (this._args.length != 0) {
				context.errors.push(new CompileError(this._qualifiedName.getToken(), "no function with matching arguments"));
				return true;
			}
		} else if ((ctorType = ctorType.deduceByArgumentTypes(context, this._qualifiedName.getToken(), argTypes, false)) == null) {
			// error is reported by callee
			return true;
		}
		this._ctorType = ctorType;
		return true;
	}

});

// statements that take one expression

var UnaryExpressionStatement = exports.UnaryExpressionStatement = Statement.extend({

	constructor: function (expr) {
		if (expr == null)
			throw new Error("logic flaw");
		this._expr = expr;
	},

	getToken: function () {
		return this._expr.getToken();
	},

	getExpr: function () {
		return this._expr;
	},

	doAnalyze: function (context) {
		this._expr.analyze(context, null);
		return true;
	}

});

var ExpressionStatement = exports.ExpressionStatement = UnaryExpressionStatement.extend({

	constructor: function (expr) {
		UnaryExpressionStatement.prototype.constructor.call(this, expr);
	},

	serialize: function () {
		return [
			"ExpressionStatement",
			this._expr.serialize()
		];
	}

});

var ReturnStatement = exports.ReturnStatement = Statement.extend({

	constructor: function (token, expr) {
		this._token = token;
		this._expr = expr; // nullable
	},

	getToken: function () {
		return this._token;
	},

	getExpr: function () {
		return this._expr;
	},

	serialize: function () {
		return [
			"ReturnStatement",
			Util.serializeNullable(this._expr)
		];
	},

	doAnalyze: function (context) {
		var returnType = context.funcDef.getReturnType();
		if (returnType.equals(Type.voidType)) {
			// handle return(void);
			if (this._expr != null) {
				context.errors.push(new CompileError(this._token, "cannot return a value from a void function"));
				return true;
			}
		} else {
			// handle return of values
			if (this._expr == null) {
				context.errors.push(new CompileError(this._token, "cannot return void, the function is declared to return a value of type '" + returnType.toString() + "'"));
				return true;
			}
			if (! this._expr.analyze(context, null))
				return true;
			var exprType = this._expr != null ? this._expr.getType() : Type.voidType;
			if (exprType == null)
				return true;
			if (! exprType.isConvertibleTo(returnType)) {
				context.errors.push(new CompileError(this._token, "cannot convert '" + exprType.toString() + "' to return type '" + returnType.toString() + "'"));
				return false;
			}
		}
		context.getTopBlock().localVariableStatuses = null;
		return true;
	}

});

var DeleteStatement = exports.DeleteStatement = UnaryExpressionStatement.extend({

	constructor: function (token, expr) {
		UnaryExpressionStatement.prototype.constructor.call(this, expr);
		this._token = token;
	},

	getToken: function () {
		return this._token;
	},

	serialize: function () {
		return [
			"DeleteStatement",
			this._expr.serialize()
		];
	},

	doAnalyze: function (context) {
		if (! this._expr.analyze(context, null))
			return true;
		if (! (this._expr instanceof ArrayExpression)) {
			context.errors.push(new CompileError(this._token, "only properties of a hash object can be deleted"));
			return true;
		}
		var secondExprType = this._expr.getSecondExpr().getType();
		if (secondExprType == null)
			return true; // error should have been already reported
		if (! secondExprType.resolveIfMayBeUndefined().equals(Type.stringType)) {
			context.errors.push(new CompileError(this._token, "only properties of a hash object can be deleted"));
			return true;
		}
		return true;
	}

});

// break and continue

var JumpStatement = exports.JumpStatement = Statement.extend({

	constructor: function (token, label) {
		this._token = token;
		this._label = label;
	},

	getToken: function () {
		return this._token;
	},

	getLabel: function () {
		return this._label;
	},

	serialize: function () {
		return [
			this._getName(),
			this._token.serialize(),
			Util.serializeNullable(this._label)
		];
	},

	doAnalyze: function (context) {
		var targetBlock = this._determineDestination(context);
		if (targetBlock == null)
			return true;
		if (this instanceof BreakStatement)
			targetBlock.statement.registerVariableStatusesOnBreak(context.getTopBlock().localVariableStatuses);
		else
			targetBlock.statement.registerVariableStatusesOnContinue(context.getTopBlock().localVariableStatuses);
		context.getTopBlock().localVariableStatuses = null;
		return true;
	},

	_determineDestination: function (context) {
		// find the destination by iterate to the one before the last, which is function scope
		for (var i = context.blockStack.length - 1; i > 0; --i) {
			var statement = context.blockStack[i].statement;
			// continue unless we are at the destination level
			if (! (statement instanceof LabellableStatement))
				continue;
			if (this._label != null) {
				var statementLabel = statement.getLabel();
				if (statementLabel != null && statementLabel.getValue() == this._label.getValue()) {
					if (this._token.getValue() == "continue" && statement instanceof SwitchStatement) {
						context.errors.push(new CompileError(this._token, "cannot 'continue' to a switch statement"));
						return null;
					}
				} else {
					continue;
				}
			} else {
				if (this._token.getValue() == "continue" && statement instanceof SwitchStatement)
					continue;
			}
			// found the destination
			return context.blockStack[i];
		}
		if (this._label != null)
			context.errors.push(new CompileError(this._label, "label '" + this._label.getValue() + "' is either not defined or invalid as the destination"));
		else
			context.errors.push(new CompileError(this._token, "cannot '" + this._token.getValue() + "' at this point"));
		return null;
	}

});

var BreakStatement = exports.BreakStatement = JumpStatement.extend({

	constructor: function (token, label) {
		JumpStatement.prototype.constructor.call(this, token, label);
	},

	_getName: function () {
		return "BreakStatement";
	}

});

var ContinueStatement = exports.ContinueStatement = JumpStatement.extend({

	constructor: function (token, label) {
		JumpStatement.prototype.constructor.call(this, token, label);
	},

	_getName: function () {
		return "ContinueStatement";
	}

});

// control flow statements

var LabellableStatement = exports.LabellableStatement = Statement.extend({

	constructor: function (token, label) {
		this._token = token;
		this._label = label;
	},

	getToken: function () {
		return this._token;
	},

	getLabel: function () {
		return this._label;
	},

	_serialize: function () {
		return [
			Util.serializeNullable(this._label)
		];
	},

	_prepareBlockAnalysis: function (context) {
		context.blockStack.push(new BlockContext(context.getTopBlock().localVariableStatuses.clone(), this));
		this._lvStatusesOnBreak = null;
	},

	_abortBlockAnalysis: function (context) {
		context.blockStack.pop();
		this._lvStatusesOnBreak = null;
	},

	_finalizeBlockAnalysis: function (context) {
		context.blockStack.pop();
		context.getTopBlock().localVariableStatuses = this._lvStatusesOnBreak;
		this._lvStatusesOnBreak = null;
	},

	registerVariableStatusesOnBreak: function (statuses) {
		if (statuses != null) {
			if (this._lvStatusesOnBreak == null)
				this._lvStatusesOnBreak = statuses.clone();
			else
				this._lvStatusesOnBreak = this._lvStatusesOnBreak.merge(statuses);
		}
	}

});

var ContinuableStatement = exports.ContinuableStatement = LabellableStatement.extend({

	constructor: function (token, label) {
		LabellableStatement.prototype.constructor.call(this, token, label);
	},

	_prepareBlockAnalysis: function (context) {
		LabellableStatement.prototype._prepareBlockAnalysis.call(this, context);
		this._lvStatusesOnContinue = null;
	},

	_abortBlockAnalysis: function (context) {
		LabellableStatement.prototype._abortBlockAnalysis.call(this, context);
		this._lvStatusesOnContinue = null;
	},

	_finalizeBlockAnalysis: function (context) {
		LabellableStatement.prototype._finalizeBlockAnalysis.call(this, context);
		this._restoreContinueVariableStatuses(context);
	},

	_restoreContinueVariableStatuses: function (context) {
		if (this._lvStatusesOnContinue != null) {
			if (context.getTopBlock().localVariableStatuses != null)
				context.getTopBlock().localVariableStatuses = context.getTopBlock().localVariableStatuses.merge(this._lvStatusesOnContinue);
			else
				context.getTopBlock().localVariableStatuses = this._lvStatusesOnContinue;
			this._lvStatusesOnContinue = null;
		}
	},

	registerVariableStatusesOnContinue: function (statuses) {
		if (statuses != null) {
			if (this._lvStatusesOnContinue == null)
				this._lvStatusesOnContinue = statuses.clone();
			else
				this._lvStatusesOnContinue = this._lvStatusesOnContinue.merge(statuses);
		}
	}

});

var DoWhileStatement = exports.DoWhileStatement = ContinuableStatement.extend({

	constructor: function (token, label, expr, statements) {
		ContinuableStatement.prototype.constructor.call(this, token, label);
		this._expr = expr;
		this._statements = statements;
	},

	getExpr: function () {
		return this._expr;
	},

	getStatements: function () {
		return this._statements;
	},

	serialize: function () {
		return [
			"DoWhileStatement"
		].concat(this._serialize()).concat([
			this._expr.serialize(),
			Util.serializeArray(this._statements)
		]);
	},

	doAnalyze: function (context) {
		this._prepareBlockAnalysis(context);
		try {
			for (var i = 0; i < this._statements.length; ++i)
				if (! this._statements[i].analyze(context))
					return false;
			this._restoreContinueVariableStatuses(context);
			if (! Statement.assertIsReachable(context, this._expr.getToken()))
				return false;
			if (this._expr.analyze(context, null))
				if (! this._expr.getType().equals(Type.booleanType))
					context.errors.push(new CompileError(this._expr.getToken(), "expression of the while statement should return a boolean"));
			this.registerVariableStatusesOnBreak(context.getTopBlock().localVariableStatuses);
			this._finalizeBlockAnalysis(context);
		} catch (e) {
			this._abortBlockAnalysis(context);
			throw e;
		}
		return true;
	}

});

var ForInStatement = exports.ForInStatement = ContinuableStatement.extend({

	constructor: function (token, label, identifier, expr, statements) {
		ContinuableStatement.prototype.constructor.call(this, token, label);
		this._identifier = identifier;
		this._expr = expr;
		this._statements = statements;
	},

	serialize: function () {
		return [
			"ForInStatement",
		].concat(this._serialize()).concat([
			this._identifier.serialize(),
			this._expr.serialize(),
			Util.serializeArray(this._statements)
		]);
	},

	doAnalyze: function (context) {
		this._expr.analyze(context, null);
		this._prepareBlockAnalysis(context);
		try {
			for (var i = 0; i < this._statements.length; ++i)
				if (! this._statements[i].analyze(context))
					return false;
			this.registerVariableStatusesOnContinue(context.getTopBlock().localVariableStatuses);
			this._finalizeBlockAnalysis(context);
		} catch (e) {
			this._abortBlockAnalysis(context);
			throw e;
		}
		return true;
	}

});

var ForStatement = exports.ForStatement = ContinuableStatement.extend({

	constructor: function (token, label, initExpr, condExpr, postExpr, statements) {
		ContinuableStatement.prototype.constructor.call(this, token, label);
		this._initExpr = initExpr;
		this._condExpr = condExpr;
		this._postExpr = postExpr;
		this._statements = statements;
	},

	getInitExpr: function () {
		return this._initExpr;
	},

	getCondExpr: function () {
		return this._condExpr;
	},

	getPostExpr: function () {
		return this._postExpr;
	},

	getStatements: function () {
		return this._statements;
	},

	serialize: function () {
		return [
			"ForStatement",
		].concat(this._serialize()).concat([
			Util.serializeNullable(this._initExpr),
			Util.serializeNullable(this._condExpr),
			Util.serializeNullable(this._postExpr),
			Util.serializeArray(this._statements)
		]);
	},

	doAnalyze: function (context) {
		if (this._initExpr != null)
			this._initExpr.analyze(context, null);
		if (this._condExpr != null)
			if (this._condExpr.analyze(context, null))
				if (! this._condExpr.getType().equals(Type.booleanType))
					context.errors.push(new CompileError(this._condExpr.getToken(), "condition expression of the for statement should return a boolean"));
		this._prepareBlockAnalysis(context);
		try {
			for (var i = 0; i < this._statements.length; ++i)
				if (! this._statements[i].analyze(context))
					return false;
			this._restoreContinueVariableStatuses(context);
			if (this._postExpr != null) {
				if (! Statement.assertIsReachable(context, this._postExpr.getToken()))
					return false;
				this._postExpr.analyze(context, null);
				this.registerVariableStatusesOnBreak(context.getTopBlock().localVariableStatuses);
			}
			this._finalizeBlockAnalysis(context);
		} catch (e) {
			this._abortBlockAnalysis(context);
			throw e;
		}
		return true;
	}

});

var IfStatement = exports.IfStatement = Statement.extend({

	constructor: function (token, expr, onTrueStatements, onFalseStatements) {
		this._token = token;
		this._expr = expr;
		this._onTrueStatements = onTrueStatements;
		this._onFalseStatements = onFalseStatements;
	},

	getToken: function () {
		return this._token;
	},

	getExpr: function () {
		return this._expr;
	},

	getOnTrueStatements: function () {
		return this._onTrueStatements;
	},

	getOnFalseStatements: function () {
		return this._onFalseStatements;
	},

	serialize: function () {
		return [
			"IfStatement",
			this._expr.serialize(),
			Util.serializeArray(this._onTrueStatements),
			Util.serializeArray(this._onFalseStatements)
		];
	},

	doAnalyze: function (context) {
		if (this._expr.analyze(context, null))
			if (! this._expr.getType().equals(Type.booleanType))
				context.errors.push(new CompileError(this._expr.getToken(), "expression of the if statement should return a boolean"));
		// if the expr is true
		context.blockStack.push(new BlockContext(context.getTopBlock().localVariableStatuses.clone(), this));
		try {
			for (var i = 0; i < this._onTrueStatements.length; ++i)
				if (! this._onTrueStatements[i].analyze(context))
					return false;
			var lvStatusesOnTrueStmts = context.getTopBlock().localVariableStatuses;
		} finally {
			context.blockStack.pop();
		}
		// if the expr is false
		try {
			context.blockStack.push(new BlockContext(context.getTopBlock().localVariableStatuses.clone(), this));
			for (var i = 0; i < this._onFalseStatements.length; ++i)
				if (! this._onFalseStatements[i].analyze(context))
					return false;
			var lvStatusesOnFalseStmts = context.getTopBlock().localVariableStatuses;
		} finally {
			context.blockStack.pop();
		}
		// merge the variable statuses
		if (lvStatusesOnTrueStmts != null)
			if (lvStatusesOnFalseStmts != null)
				context.getTopBlock().localVariableStatuses = lvStatusesOnTrueStmts.merge(lvStatusesOnFalseStmts);
			else
				context.getTopBlock().localVariableStatuses = lvStatusesOnTrueStmts;
		else
			context.getTopBlock().localVariableStatuses = lvStatusesOnFalseStmts;
		return true;
	}

});

var SwitchStatement = exports.SwitchStatement = LabellableStatement.extend({

	constructor: function (token, label, expr, statements) {
		LabellableStatement.prototype.constructor.call(this, token, label);
		this._expr = expr;
		this._statements = statements;
	},

	getExpr: function () {
		return this._expr;
	},

	getStatements: function () {
		return this._statements;
	},

	serialize: function () {
		return [
			"SwitchStatement",
		].concat(this._serialize()).concat([
			this._expr.serialize(),
			Util.serializeArray(this._statements)
		]);
	},

	doAnalyze: function (context) {
		if (! this._expr.analyze(context, null))
			return true;
		var exprType = this._expr.getType();
		if (exprType == null)
			return true;
		if (! (exprType.equals(Type.booleanType) || exprType.equals(Type.integerType) || exprType.equals(Type.numberType) || exprType.equals(Type.stringType))) {
			context.errors.push(new CompileError(this._token, "switch statement only accepts boolean, number, or string expressions"));
			return true;
		}
		this._prepareBlockAnalysis(context);
		try {
			var hasDefaultLabel = false;
			for (var i = 0; i < this._statements.length; ++i) {
				var statement = this._statements[i];
				if (! statement.analyze(context))
					return false;
				if (statement instanceof DefaultStatement)
					hasDefaultLabel = true;
			}
			if (! hasDefaultLabel)
				this.registerVariableStatusesOnBreak(context.blockStack[context.blockStack.length - 2].localVariableStatuses);
			this._finalizeBlockAnalysis(context);
		} catch (e) {
			this._abortBlockAnalysis(context);
			throw e;
		}
		return true;
	},

	$resetLocalVariableStatuses: function (context) {
		context.getTopBlock().localVariableStatuses = context.blockStack[context.blockStack.length - 2].localVariableStatuses.clone();
	}

});

var CaseStatement = exports.CaseStatement = Statement.extend({

	constructor: function (token, expr) {
		this._token = token;
		this._expr = expr;
	},

	getToken: function () {
		return this._token;
	},

	getExpr: function () {
		return this._expr;
	},

	serialize: function () {
		return [
			"CaseStatement",
			this._expr.serialize()
		];
	},

	doAnalyze: function (context) {
		if (! this._expr.analyze(context, null))
			return true;
		var statement = context.getTopBlock().statement;
		if (! (statement instanceof SwitchStatement))
			throw new Error("logic flaw");
		var expectedType = statement.getExpr().getType();
		if (expectedType == null)
			return true;
		var exprType = this._expr.getType();
		if (exprType == null)
			return true;
		if (exprType.equals(expectedType)) {
			// ok
		} else if (Type.isIntegerOrNumber(exprType) && Type.isIntegerOrNumber(expectedType)) {
			// ok
		} else if (expectedType.equals(Type.stringType) && exprType.equals(Type.nullType)) {
			// ok
		} else {
			context.errors.push(new CompileError(this._token, "type mismatch; expected type was '" + expectedType.toString() + "' but got '" + exprType + "'"));
		}
		// reset local variable statuses
		SwitchStatement.resetLocalVariableStatuses(context);
		return true;
	}

});

var DefaultStatement = exports.DefaultStatement = Statement.extend({

	constructor: function (token) {
		this._token = token;
	},

	getToken: function () {
		return this._token;
	},

	serialize: function () {
		return [
			"DefaultStatement"
		];
	},

	doAnalyze: function (context) {
		SwitchStatement.resetLocalVariableStatuses(context);
		return true;
	}

});

var WhileStatement = exports.WhileStatement = ContinuableStatement.extend({

	constructor: function (token, label, expr, statements) {
		ContinuableStatement.prototype.constructor.call(this, token, label);
		this._expr = expr;
		this._statements = statements;
	},

	getExpr: function () {
		return this._expr;
	},

	getStatements: function () {
		return this._statements;
	},

	serialize: function () {
		return [
			"WhileStatement",
		].concat(this._serialize()).concat([
			this._expr.serialize(),
			Util.serializeArray(this._statements)
		]);
	},

	doAnalyze: function (context) {
		if (this._expr.analyze(context, null))
			if (! this._expr.getType().equals(Type.booleanType))
				context.errors.push(new CompileError(this._expr.getToken(), "expression of the while statement should return a boolean"));
		this._prepareBlockAnalysis(context);
		try {
			for (var i = 0; i < this._statements.length; ++i)
				if (! this._statements[i].analyze(context))
					return false;
			this.registerVariableStatusesOnContinue(context.getTopBlock().localVariableStatuses);
			this._finalizeBlockAnalysis(context);
		} catch (e) {
			this._abortBlockAnalysis(context);
			throw e;
		}
		return true;
	}

});

var TryStatement = exports.TryStatement = Statement.extend({

	constructor: function (token, tryStatements, catchIdentifier, catchStatements, finallyStatements) {
		this._token = token;
		this._tryStatements = tryStatements;
		this._catchIdentifier = catchIdentifier; // FIXME type?
		this._catchStatements = catchStatements;
		this._finallyStatements = finallyStatements;
	},

	getToken: function () {
		return this._token;
	},

	serialize: function () {
		return [
			"TryStatement",
			Util.serializeArray(this._tryStatements),
			Util.serializeNullable(this._catchIdentifier),
			Util.serializeArray(this._catchStatements),
			Util.serializeArray(this._finallyStatements)
		];
	},

	doAnalyze: function (context) {
		try {
			context.blockStack.push(new BlockContext(context.getTopBlock().localVariableStatuses.clone(), this));
			for (var i = 0; i < this._tryStatements.length; ++i)
				if (! this._tryStatements[i].analyze(context))
					return false;
		} finally {
			context.blockStack.pop();
		}
		if (this._catchStatements != null) {
			try {
				context.blockStack.push(new BlockContext(context.getTopBlock().localVariableStatuses.clone(), this));
				for (var i = 0; i < this._catchStatements.length; ++i)
					if (! this._catchStatements[i].analyze(context))
						return false;
			} finally {
				context.blockStack.pop();
			}
		}
		if (this._finallyStatements != null) {
			try {
				context.blockStack.push(new BlockContext(context.getTopBlock().localVariableStatuses.clone(), this));
				for (var i = 0; i < this._finallyStatements.length; ++i)
					if (! this._finallyStatements[i].analyze(context))
						return false;
			} finally {
				context.blockStack.pop();
			}
		}
		return true;
	}

});

// information statements

var InformationStatement = exports.InformationStatement = Statement.extend({

	constructor: function (token, exprs) {
		this._token = token;
		this._exprs = exprs;
	},

	getToken: function () {
		return this._token;
	},

	getExprs: function () {
		return this._exprs;
	},

	_analyzeExprs: function (context) {
		for (var i = 0; i < this._exprs.length; ++i)
			if (! this._exprs[i].analyze(context, null))
				return false;
		return true;
	}

});

var AssertStatement = exports.AssertStatement = InformationStatement.extend({

	constructor: function (token, exprs) {
		InformationStatement.prototype.constructor.call(this, token, exprs);
	},

	serialize: function () {
		return [
			"AssertStatement",
			Util.serializeArray(this._exprs)
		];
	},

	doAnalyze: function (context) {
		if (! this._analyzeExprs(context))
			return true;
		var exprType = this._exprs[this._exprs.length - 1].getType();
		if (exprType.equals(Type.voidType))
			context.errors.push(new CompileError(this._token, "cannot assert type void"));
		else if (exprType.equals(Type.nullType))
			context.errors.push(new CompileError(this._token, "assertion never succeeds"));
		return true;
	}

});

var LogStatement = exports.LogStatement = InformationStatement.extend({

	constructor: function (token, exprs) {
		InformationStatement.prototype.constructor.call(this, token, exprs);
	},

	serialize: function () {
		return [
			"LogStatement",
			Util.serializeArray(this._exprs)
		];
	},

	doAnalyze: function (context) {
		if (! this._analyzeExprs(context))
			return;
		for (var i = 0; i < this._exprs.length; ++i) {
			var exprType = this._exprs[i].getType();
			if (exprType == null)
				return true;
			if (exprType.equals(Type.voidType)) {
				context.errors.push(new CompileError(this._token, "cannot log a void expression"));
				break;
			}
		}
		return true;
	}

});