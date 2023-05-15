# *****************************************************************************
#
# Copyright (c) 2019, the jupyter-fs authors.
#
# This file is part of the jupyter-fs library, distributed under the terms of
# the Apache License 2.0.  The full license can be found in the LICENSE file.
#

# for Coverage
from unittest.mock import MagicMock
import tornado.web

import pytest

from jupyterfs.extension import _load_jupyter_server_extension
from jupyterfs.metamanager import MetaManagerHandler, MetaManager


class TestExtension:
    def test_load_jupyter_server_extension(self):
        m = MagicMock()

        m.web_app.settings = {}
        m.contents_manager = MetaManager()
        m.web_app.settings["base_url"] = "/test"
        _load_jupyter_server_extension(m)

    @pytest.mark.asyncio
    async def test_get_handler(self):
        contents_manager = MetaManager()
        app = tornado.web.Application(contents_manager=contents_manager)
        m = MagicMock()
        h = MetaManagerHandler(app, m)
        h._transforms = []
        await h.get()
