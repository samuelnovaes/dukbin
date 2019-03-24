#include <iostream>
#include <regex>
#include <map>
#include "duktape.h"
#include "duk_console.h"
#include "duk_module_node.h"

using namespace std;

/*__headers__*/

map<string, const char *> indexes;
map<string, const char *> modules;

bool is_local_path(string path)
{
	return regex_match(path, regex("^\\.{1,2}\\/.+$"));
}

string node_path(string path)
{
	if (is_local_path(path) || regex_match(path, regex("^node_modules\\/.+$")))
	{
		return path;
	}
	else
	{
		return "node_modules/" + path;
	}
}

string resolve_path(string path)
{
	path = regex_replace(path, regex("[^\\/]+\\/\\.\\.\\/"), "");
	path = regex_replace(path, regex("\\.\\/"), "");
	path = regex_match(path, regex("^.+\\.js$")) ? path : (indexes.count(path) > 0 ? indexes[path] : path);
	return path;
}

string parent_path(string path)
{
	path = regex_replace(path, regex("\\/[^\\/]+$"), "");
	return path;
}

int cb_resolve_module(duk_context *ctx)
{
	string requested_id = duk_get_string(ctx, 0);
	string parent_id = duk_get_string(ctx, 1);
	string resolved_id = node_path(is_local_path(requested_id) ? parent_path(parent_id) + (parent_id == "" ? "" : "/") + requested_id : requested_id);
	duk_push_string(ctx, resolved_id.c_str());
	return 1;
}

int cb_load_module(duk_context *ctx)
{
	string resolved_id = resolve_path(duk_get_string(ctx, 0));
	if (modules.count(resolved_id) > 0)
	{
		duk_push_string(ctx, modules[resolved_id]);
	}
	else
	{
		(void)duk_error(ctx, DUK_ERR_ERROR, "Cannot find module '%s'", resolved_id.c_str());
	}
	return 1;
}

int main()
{
	/*__modules__*/
	/*__indexes__*/
	duk_context *ctx = duk_create_heap_default();
	duk_console_init(ctx, 0);
	duk_push_object(ctx);
	duk_push_c_function(ctx, cb_resolve_module, DUK_VARARGS);
	duk_put_prop_string(ctx, -2, "resolve");
	duk_push_c_function(ctx, cb_load_module, DUK_VARARGS);
	duk_put_prop_string(ctx, -2, "load");
	duk_module_node_init(ctx);

	/*__functions__*/

	if (duk_peval_string(ctx, "__content__") != 0)
	{
		cout << duk_safe_to_string(ctx, -1) << endl;
	}
	duk_pop(ctx);

	duk_destroy_heap(ctx);
	return 0;
}