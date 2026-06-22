<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/*">
<xsl:apply-templates/>
</xsl:template>

<xsl:template match="//AMP">
<xsl:value-of select="APID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="INVALID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="VPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NM"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="ABBREVNM"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="DESC"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NMDT"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NM_PREV"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="SUPPCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="LIC_AUTHCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="LIC_AUTH_PREVCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="LIC_AUTHCHANGECD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="LIC_AUTHCHANGEDT"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="COMBPRODCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="FLAVOURCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="EMA"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PARALLEL_IMPORT"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="AVAIL_RESTRICTCD"/>

<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>
