<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/VTM">
<xsl:apply-templates/>
</xsl:template>

<xsl:template match="/*/*">
<xsl:value-of select="VTMID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="INVALID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NM"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="ABBREVNM"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="VTMIDPREV"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="VTMIDDT"/>
<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>