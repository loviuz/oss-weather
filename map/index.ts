import 'leaflet/dist/leaflet.css';
import './app.css';
import * as L from 'leaflet';
import 'leaflet-wms-header';

function GetURLParameter(sParam) {
    const sPageURL = window.location.search.substring(1);
    const sURLVariables = sPageURL.split('&');
    for (let i = 0; i < sURLVariables.length; i++) {
        const sParameterName = sURLVariables[i].split('=');
        if (sParameterName[0] === sParam) {
            return sParameterName[1];
        }
    }
}

const position = (GetURLParameter('position') || '45.18453,5.75').split(',').map(parseFloat);
const zoom = parseFloat(GetURLParameter('zoom') || '8');
const OWM_KEY = GetURLParameter('owm_key');

const map = L.map('map', { zoomControl: false }).setView(position, zoom);

// @class TileLayer

L.TileLayer.mergeOptions({
    // @option keepBuffer
    // The amount of tiles outside the visible map area to be kept in the stitched
    // `TileLayer`.

    // @option dumpToCanvas: Boolean = true
    // Whether to dump loaded tiles to a `<canvas>` to prevent some rendering
    // artifacts. (Disabled by default in IE)
    dumpToCanvas: L.Browser.canvas && !L.Browser.ie
});

L.TileLayer.include({
    _onUpdateLevel(z, zoom) {
        if (this.options.dumpToCanvas) {
            this._levels[z].canvas.style.zIndex = this.options.maxZoom - Math.abs(zoom - z);
        }
    },

    _onRemoveLevel(z) {
        if (this.options.dumpToCanvas) {
            L.DomUtil.remove(this._levels[z].canvas);
        }
    },

    _onCreateLevel(level) {
        if (this.options.dumpToCanvas) {
            level.canvas = L.DomUtil.create('canvas', 'leaflet-tile-container leaflet-zoom-animated', this._container);
            level.ctx = level.canvas.getContext('2d');
            this._resetCanvasSize(level);
        }
    },

    _removeTile(key) {
        if (this.options.dumpToCanvas) {
            const tile = this._tiles[key];
            const level = this._levels[tile.coords.z];
            const tileSize = this.getTileSize();

            if (level) {
                // Where in the canvas should this tile go?
                const offset = L.point(tile.coords.x, tile.coords.y).subtract(level.canvasRange.min).scaleBy(this.getTileSize());

                level.ctx.clearRect(offset.x, offset.y, tileSize.x, tileSize.y);
            }
        }

        L.GridLayer.prototype._removeTile.call(this, key);
    },

    _resetCanvasSize(level) {
        const buff = this.options.keepBuffer,
            pixelBounds = this._getTiledPixelBounds(this._map.getCenter()),
            tileRange = this._pxBoundsToTileRange(pixelBounds),
            tileSize = this.getTileSize();

        tileRange.min = tileRange.min.subtract([buff, buff]); // This adds the no-prune buffer
        tileRange.max = tileRange.max.add([buff + 1, buff + 1]);

        const pixelRange = L.bounds(
                tileRange.min.scaleBy(tileSize),
                tileRange.max.add([1, 1]).scaleBy(tileSize) // This prevents an off-by-one when checking if tiles are inside
            ),
            neededSize = pixelRange.max.subtract(pixelRange.min);
        let mustRepositionCanvas = false;

        // Resize the canvas, if needed, and only to make it bigger.
        if (neededSize.x > level.canvas.width || neededSize.y > level.canvas.height) {
            // Resizing canvases erases the currently drawn content, I'm afraid.
            // To keep it, dump the pixels to another canvas, then display it on
            // top. This could be done with getImageData/putImageData, but that
            // would break for tainted canvases (in non-CORS tilesets)
            const oldSize = { x: level.canvas.width, y: level.canvas.height };
            // console.info('Resizing canvas from ', oldSize, 'to ', neededSize);

            const tmpCanvas = L.DomUtil.create('canvas');
            tmpCanvas.style.width = (tmpCanvas.width = oldSize.x) + 'px';
            tmpCanvas.style.height = (tmpCanvas.height = oldSize.y) + 'px';
            tmpCanvas.getContext('2d').drawImage(level.canvas, 0, 0);
            // var data = level.ctx.getImageData(0, 0, oldSize.x, oldSize.y);

            level.canvas.style.width = (level.canvas.width = neededSize.x) + 'px';
            level.canvas.style.height = (level.canvas.height = neededSize.y) + 'px';
            level.ctx.drawImage(tmpCanvas, 0, 0);
            // level.ctx.putImageData(data, 0, 0, 0, 0, oldSize.x, oldSize.y);
        }

        // Translate the canvas contents if it's moved around
        if (level.canvasRange) {
            const offset = level.canvasRange.min.subtract(tileRange.min).scaleBy(this.getTileSize());

            // 			console.info('Offsetting by ', offset);

            if (!L.Browser.safari) {
                // By default, canvases copy things "on top of" existing pixels, but we want
                // this to *replace* the existing pixels when doing a drawImage() call.
                // This will also clear the sides, so no clearRect() calls are needed to make room
                // for the new tiles.
                level.ctx.globalCompositeOperation = 'copy';
                level.ctx.drawImage(level.canvas, offset.x, offset.y);
                level.ctx.globalCompositeOperation = 'source-over';
            } else {
                // Safari clears the canvas when copying from itself :-(
                if (!this._tmpCanvas) {
                    const t = (this._tmpCanvas = L.DomUtil.create('canvas'));
                    t.width = level.canvas.width;
                    t.height = level.canvas.height;
                    this._tmpContext = t.getContext('2d');
                }
                this._tmpContext.clearRect(0, 0, level.canvas.width, level.canvas.height);
                this._tmpContext.drawImage(level.canvas, 0, 0);
                level.ctx.clearRect(0, 0, level.canvas.width, level.canvas.height);
                level.ctx.drawImage(this._tmpCanvas, offset.x, offset.y);
            }

            mustRepositionCanvas = true; // Wait until new props are set
        }

        level.canvasRange = tileRange;
        level.canvasPxRange = pixelRange;
        level.canvasOrigin = pixelRange.min;

        // console.log('Canvas tile range: ', level, tileRange.min, tileRange.max );
        // console.log('Canvas pixel range: ', pixelRange.min, pixelRange.max );
        // console.log('Level origin: ', level.origin );

        if (mustRepositionCanvas) {
            this._setCanvasZoomTransform(level, this._map.getCenter(), this._map.getZoom());
        }
    },

    /// set transform/position of canvas, in addition to the transform/position of the individual tile container
    _setZoomTransform(level, center, zoom) {
        L.GridLayer.prototype._setZoomTransform.call(this, level, center, zoom);
        if (this.options.dumpToCanvas) {
            this._setCanvasZoomTransform(level, center, zoom);
        }
    },

    // This will get called twice:
    // * From _setZoomTransform
    // * When the canvas has shifted due to a new tile being loaded
    _setCanvasZoomTransform(level, center, zoom) {
        // console.log('_setCanvasZoomTransform', level, center, zoom);
        if (!level.canvasOrigin) {
            return;
        }
        const scale = this._map.getZoomScale(zoom, level.zoom),
            translate = level.canvasOrigin.multiplyBy(scale).subtract(this._map._getNewPixelOrigin(center, zoom)).round();

        if (L.Browser.any3d) {
            L.DomUtil.setTransform(level.canvas, translate, scale);
        } else {
            L.DomUtil.setPosition(level.canvas, translate);
        }
    },

    _onOpaqueTile(tile) {
        if (!this.options.dumpToCanvas) {
            return;
        }

        // Guard against an NS_ERROR_NOT_AVAILABLE (or similar) exception
        // when a non-image-tile has been loaded (e.g. a WMS error).
        // Checking for tile.el.complete is not enough, as it has been
        // already marked as loaded and ready somehow.
        try {
            this.dumpPixels(tile.coords, tile.el);
        } catch (ex) {
            return this.fire('tileerror', {
                error: 'Could not copy tile pixels: ' + ex,
                tile,
                coods: tile.coords
            });
        }

        // If dumping the pixels was successful, then hide the tile.
        // Do not remove the tile itself, as it is needed to check if the whole
        // level (and its canvas) should be removed (via level.el.children.length)
        tile.el.style.display = 'none';
    },

    // @section Extension methods
    // @uninheritable

    // @method dumpPixels(coords: Object, imageSource: CanvasImageSource): this
    // Dumps pixels from the given `CanvasImageSource` into the layer, into
    // the space for the tile represented by the `coords` tile coordinates (an object
    // like `{x: Number, y: Number, z: Number}`; the image source must have the
    // same size as the `tileSize` option for the layer. Has no effect if `dumpToCanvas`
    // is `false`.
    dumpPixels(coords, imageSource) {
        const level = this._levels[coords.z],
            tileSize = this.getTileSize();

        if (!level.canvasRange || !this.options.dumpToCanvas) {
            return;
        }

        // Check if the tile is inside the currently visible map bounds
        // There is a possible race condition when tiles are loaded after they
        // have been panned outside of the map.
        if (!level.canvasRange.contains(coords)) {
            this._resetCanvasSize(level);
        }

        // Where in the canvas should this tile go?
        const offset = L.point(coords.x, coords.y).subtract(level.canvasRange.min).scaleBy(this.getTileSize());

        level.ctx.drawImage(imageSource, offset.x, offset.y, tileSize.x, tileSize.y);

        // TODO: Clear the pixels of other levels' canvases where they overlap
        // this newly dumped tile.
        return this;
    }
});

L.TileLayer.wmsHeader(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
        maxZoom: 19,
        pmIgnore: false,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    },
    [
        {
            header: 'User-Agent',
            value: 'AlpiMaps'
        }
    ]
).addTo(map);
L.tileLayer(`https://{s}.sat.owm.io/vane/2.0/weather/PA0/{z}/{x}/{y}?appid=${OWM_KEY}&palette=0:00000000;0.1:C8969620;0.2:9696AA30;0.5:7878BE40;1:6E6ECD70;10:5050E1B2;140:1414FFE5&opacity=0.8`, {
    maxZoom: 18,
    pmIgnore: false,
    subdomains: ['a', 'b', 'c']
}).addTo(map);
